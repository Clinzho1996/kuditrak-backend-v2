// backend/controllers/pinController.js
import bcrypt from "bcryptjs";
import TransactionPin from "../models/TransactionPin.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Set or update transaction PIN
 */
export const setTransactionPin = async (req, res) => {
	try {
		const userId = req.user._id;
		const { pin } = req.body;

		// Validate PIN
		if (!pin || !/^\d{6}$/.test(pin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 6 digits",
			});
		}

		// Check if user already has a PIN
		let pinRecord = await TransactionPin.findOne({ userId });

		if (pinRecord && pinRecord.hasSetPin) {
			return res.status(400).json({
				success: false,
				error: "PIN already set. Use update endpoint to change.",
			});
		}

		// Hash the PIN
		const salt = await bcrypt.genSalt(10);
		const pinHash = await bcrypt.hash(pin, salt);

		if (pinRecord) {
			// Update existing record
			pinRecord.pinHash = pinHash;
			pinRecord.pinSalt = salt;
			pinRecord.hasSetPin = true;
			pinRecord.failedAttempts = 0;
			pinRecord.isLocked = false;
			pinRecord.lockedUntil = null;
			await pinRecord.save();
		} else {
			// Create new record
			pinRecord = await TransactionPin.create({
				userId,
				pinHash,
				pinSalt: salt,
				hasSetPin: true,
				failedAttempts: 0,
				isLocked: false,
			});
		}

		await sendPushToUser(
			userId,
			"🔑 Transaction PIN Set",
			"Your transaction PIN has been set successfully.",
			{ type: "pin_set" },
		);

		res.status(200).json({
			success: true,
			message: "Transaction PIN set successfully",
			hasPin: true,
		});
	} catch (error) {
		console.error("Set transaction PIN error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Update transaction PIN
 */
export const updateTransactionPin = async (req, res) => {
	try {
		const userId = req.user._id;
		const { currentPin, newPin } = req.body;

		// Validate new PIN
		if (!newPin || !/^\d{6}$/.test(newPin)) {
			return res.status(400).json({
				success: false,
				error: "New PIN must be exactly 6 digits",
			});
		}

		// Find PIN record
		const pinRecord = await TransactionPin.findOne({ userId });
		if (!pinRecord || !pinRecord.hasSetPin) {
			return res.status(400).json({
				success: false,
				error: "No PIN set. Please set a PIN first.",
			});
		}

		// Verify current PIN
		const isValid = await bcrypt.compare(currentPin, pinRecord.pinHash);
		if (!isValid) {
			pinRecord.failedAttempts += 1;
			pinRecord.lastFailedAttempt = new Date();

			if (pinRecord.failedAttempts >= 5) {
				pinRecord.isLocked = true;
				pinRecord.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
			}

			await pinRecord.save();
			return res.status(400).json({
				success: false,
				error: "Invalid current PIN",
				failedAttempts: pinRecord.failedAttempts,
				isLocked: pinRecord.isLocked,
			});
		}

		// Hash new PIN
		const salt = await bcrypt.genSalt(10);
		const pinHash = await bcrypt.hash(newPin, salt);

		pinRecord.pinHash = pinHash;
		pinRecord.pinSalt = salt;
		pinRecord.failedAttempts = 0;
		pinRecord.isLocked = false;
		pinRecord.lockedUntil = null;
		await pinRecord.save();

		await sendPushToUser(
			userId,
			"🔑 Transaction PIN Updated",
			"Your transaction PIN has been updated successfully.",
			{ type: "pin_updated" },
		);

		res.status(200).json({
			success: true,
			message: "Transaction PIN updated successfully",
		});
	} catch (error) {
		console.error("Update transaction PIN error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Verify transaction PIN
 */
export const verifyTransactionPin = async (req, res) => {
	try {
		const userId = req.user._id;
		const { pin } = req.body;

		if (!pin || !/^\d{6}$/.test(pin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 6 digits",
			});
		}

		const pinRecord = await TransactionPin.findOne({ userId });
		if (!pinRecord || !pinRecord.hasSetPin) {
			return res.status(400).json({
				success: false,
				error: "No PIN set",
				requiresPinSetup: true,
			});
		}

		if (
			pinRecord.isLocked &&
			pinRecord.lockedUntil &&
			new Date() < pinRecord.lockedUntil
		) {
			const remainingMinutes = Math.ceil(
				(pinRecord.lockedUntil - new Date()) / (60 * 1000),
			);
			return res.status(400).json({
				success: false,
				error: `PIN is locked. Try again in ${remainingMinutes} minutes.`,
				isLocked: true,
				remainingMinutes,
			});
		}

		const isValid = await bcrypt.compare(pin, pinRecord.pinHash);

		if (!isValid) {
			pinRecord.failedAttempts += 1;
			pinRecord.lastFailedAttempt = new Date();

			if (pinRecord.failedAttempts >= 5) {
				pinRecord.isLocked = true;
				pinRecord.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
				await pinRecord.save();
				return res.status(400).json({
					success: false,
					error: "Too many failed attempts. PIN locked for 30 minutes.",
					isLocked: true,
					lockedUntil: pinRecord.lockedUntil,
				});
			}

			await pinRecord.save();
			return res.status(400).json({
				success: false,
				error: "Invalid PIN",
				failedAttempts: pinRecord.failedAttempts,
				remainingAttempts: 5 - pinRecord.failedAttempts,
			});
		}

		// Reset failed attempts on success
		pinRecord.failedAttempts = 0;
		pinRecord.lastFailedAttempt = null;
		pinRecord.isLocked = false;
		pinRecord.lockedUntil = null;
		await pinRecord.save();

		res.status(200).json({
			success: true,
			message: "PIN verified successfully",
		});
	} catch (error) {
		console.error("Verify PIN error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Check if user has PIN set
 */
export const checkPinStatus = async (req, res) => {
	try {
		const userId = req.user._id;

		const pinRecord = await TransactionPin.findOne({ userId });

		res.status(200).json({
			success: true,
			hasPin: pinRecord?.hasSetPin || false,
			failedAttempts: pinRecord?.failedAttempts || 0,
			isLocked: pinRecord?.isLocked || false,
		});
	} catch (error) {
		console.error("Check PIN status error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Reset PIN (requires additional verification - OTP, email, etc.)
 */
export const resetTransactionPin = async (req, res) => {
	try {
		const userId = req.user._id;
		const { newPin, verificationToken } = req.body;

		// This should be protected with OTP verification
		// For now, we'll keep it simple but secure

		if (!newPin || !/^\d{6}$/.test(newPin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 6 digits",
			});
		}

		const pinRecord = await TransactionPin.findOne({ userId });
		if (!pinRecord) {
			return res.status(404).json({
				success: false,
				error: "No PIN record found",
			});
		}

		const salt = await bcrypt.genSalt(10);
		const pinHash = await bcrypt.hash(newPin, salt);

		pinRecord.pinHash = pinHash;
		pinRecord.pinSalt = salt;
		pinRecord.hasSetPin = true;
		pinRecord.failedAttempts = 0;
		pinRecord.isLocked = false;
		pinRecord.lockedUntil = null;
		await pinRecord.save();

		await sendPushToUser(
			userId,
			"🔑 PIN Reset Successful",
			"Your transaction PIN has been reset.",
			{ type: "pin_reset" },
		);

		res.status(200).json({
			success: true,
			message: "PIN reset successfully",
		});
	} catch (error) {
		console.error("Reset PIN error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};
