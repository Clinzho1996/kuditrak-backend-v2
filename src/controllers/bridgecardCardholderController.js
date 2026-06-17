// backend/controllers/bridgecardCardholderController.js
import BridgecardCardholder from "../models/BridgecardCardholder.js";
import User from "../models/User.js";
import bridgecardService from "../services/bridgecardService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Register a user as a Bridgecard cardholder
 * Uses Anchor KYC data if available
 */
export const registerCardholder = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Check if already registered
		let existingCardholder = await BridgecardCardholder.findOne({ userId });
		if (existingCardholder) {
			return res.status(400).json({
				success: false,
				error: "Cardholder already registered",
				cardholderId: existingCardholder.cardholderId,
				isActive: existingCardholder.isActive,
				isIdVerified: existingCardholder.isIdVerified,
			});
		}

		// Prepare cardholder data from user
		const nameParts = user.fullName.split(" ");
		const firstName = nameParts[0];
		const lastName = nameParts.slice(1).join(" ") || firstName;

		// Format phone number (E.164)
		const phone = bridgecardService.formatPhoneNumber(
			user.phoneNumber || "08000000000",
		);

		const cardholderData = {
			first_name: firstName,
			last_name: lastName,
			address: {
				address: user.kyc?.address?.street || "Unknown Street",
				city: user.kyc?.address?.city || "Lagos",
				state: user.kyc?.address?.state || "Lagos",
				country: "Nigeria",
				postal_code: user.kyc?.address?.postalCode || "1000242",
				house_no: "1",
			},
			phone: phone,
			email_address: user.email,
			identity: {
				id_type: "NIGERIAN_BVN_VERIFICATION",
				bvn: user.kyc?.bvn || "22222222222222",
				selfie_image: user.profileImage || "https://example.com/selfie.jpg",
			},
			meta_data: {
				userId: user._id.toString(),
				platform: "kuditrak",
			},
		};

		// Register cardholder synchronously
		const result =
			await bridgecardService.registerCardholderSync(cardholderData);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
				details: result.details,
			});
		}

		// Save to database
		const cardholder = await BridgecardCardholder.create({
			userId,
			cardholderId: result.cardholderId,
			isActive: false,
			isIdVerified: false,
			bridgecardData: result.data || {},
			metaData: { registeredAt: new Date() },
		});

		// Send notification
		await sendPushToUser(
			userId,
			"🏦 Bridgecard Registration Submitted",
			"Your cardholder registration is being processed. You'll be notified when verified.",
			{ type: "bridgecard_registered", cardholderId: result.cardholderId },
		);

		res.status(201).json({
			success: true,
			message:
				"Cardholder registered successfully. KYC verification in progress.",
			cardholderId: result.cardholderId,
			status: "pending",
		});
	} catch (error) {
		console.error("Register cardholder error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get cardholder details and status
 */
export const getCardholderStatus = async (req, res) => {
	try {
		const userId = req.user._id;

		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res.status(404).json({
				success: false,
				error: "Cardholder not found. Please register first.",
			});
		}

		// Get fresh status from Bridgecard
		const status = await bridgecardService.getCardholder(
			cardholder.cardholderId,
		);

		if (status.success) {
			// Update local cache
			cardholder.isActive = status.isActive;
			cardholder.isIdVerified = status.isIdVerified;
			cardholder.bridgecardData = status.cardholder;
			await cardholder.save();
		}

		res.status(200).json({
			success: true,
			cardholder: {
				id: cardholder.cardholderId,
				isActive: cardholder.isActive,
				isIdVerified: cardholder.isIdVerified,
				canIssueCards: cardholder.isActive && cardholder.isIdVerified,
				details: status.success ? status.cardholder : null,
			},
		});
	} catch (error) {
		console.error("Get cardholder status error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Update cardholder information
 */
export const updateCardholder = async (req, res) => {
	try {
		const userId = req.user._id;
		const updates = req.body;

		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res.status(404).json({ error: "Cardholder not found" });
		}

		// Prepare update data
		const updateData = {
			first_name: updates.firstName,
			last_name: updates.lastName,
			address: updates.address,
			phone: updates.phone
				? bridgecardService.formatPhoneNumber(updates.phone)
				: undefined,
			meta_data: updates.metaData,
		};

		// Remove undefined fields
		Object.keys(updateData).forEach(
			(key) => updateData[key] === undefined && delete updateData[key],
		);

		const result = await bridgecardService.updateCardholder(
			cardholder.cardholderId,
			updateData,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message: "Cardholder updated successfully",
		});
	} catch (error) {
		console.error("Update cardholder error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Delete cardholder
 */
export const deleteCardholder = async (req, res) => {
	try {
		const userId = req.user._id;

		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res.status(404).json({ error: "Cardholder not found" });
		}

		const result = await bridgecardService.deleteCardholder(
			cardholder.cardholderId,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		await BridgecardCardholder.deleteOne({ userId });

		res.status(200).json({
			success: true,
			message: "Cardholder deleted successfully",
		});
	} catch (error) {
		console.error("Delete cardholder error:", error);
		res.status(500).json({ error: error.message });
	}
};
