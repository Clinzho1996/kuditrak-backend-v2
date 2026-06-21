// controllers/requestController.js
import Request from "../models/Request.js";
import User from "../models/User.js";
import { sendRequestNotificationEmail } from "../services/emailService.js";
import { sendPushToUser } from "../services/pushService.js";

// ================= CREATE REQUEST =================
export const createRequest = async (req, res) => {
	try {
		const { recipientId, amount, note } = req.body;
		const userId = req.user._id;

		// Validate
		if (!recipientId) {
			return res.status(400).json({ error: "Recipient ID is required" });
		}

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Valid amount is required" });
		}

		if (recipientId === userId.toString()) {
			return res
				.status(400)
				.json({ error: "You cannot request money from yourself" });
		}

		// Check if recipient exists
		const recipient = await User.findById(recipientId);
		if (!recipient) {
			return res.status(404).json({ error: "Recipient not found" });
		}

		// Get sender
		const sender = await User.findById(userId);

		// Create request
		const request = new Request({
			senderId: userId,
			recipientId: recipientId,
			amount: amount,
			note: note || "",
			status: "pending",
			reference: `REQ_${Date.now()}_${userId.toString().slice(-6)}`,
		});

		await request.save();

		// ✅ Send in-app push notification to recipient
		await sendPushToUser(
			recipientId,
			"💰 Money Request",
			`${sender.fullName} requested ₦${amount.toLocaleString()} from you${note ? `: "${note}"` : ""}`,
			{
				type: "money_request",
				requestId: request._id,
				senderId: userId,
				senderName: sender.fullName,
				amount: amount,
				reference: request.reference,
				screen: "requests",
			},
		);

		// ✅ Send email notification to recipient
		try {
			await sendRequestNotificationEmail({
				recipientEmail: recipient.email,
				recipientName: recipient.fullName,
				senderName: sender.fullName,
				amount: amount,
				note: note || "",
				requestId: request._id,
				reference: request.reference,
			});
			console.log(`📧 Request email sent to ${recipient.email}`);
		} catch (emailError) {
			console.error("Email error:", emailError);
			// Continue even if email fails
		}

		res.status(201).json({
			success: true,
			message: "Request sent successfully",
			requestId: request._id,
			reference: request.reference,
			timestamp: request.createdAt,
		});
	} catch (error) {
		console.error("Create request error:", error);
		res.status(500).json({ error: error.message });
	}
};

// ================= GET USER REQUESTS =================
export const getUserRequests = async (req, res) => {
	try {
		const userId = req.user._id;
		const { status } = req.query;

		const query = {
			$or: [{ senderId: userId }, { recipientId: userId }],
		};

		if (status && status !== "all") {
			query.status = status;
		}

		const requests = await Request.find(query)
			.populate("senderId", "fullName email profileImage")
			.populate("recipientId", "fullName email profileImage")
			.sort({ createdAt: -1 })
			.lean();

		// Format response
		const formattedRequests = requests.map((req) => {
			const isSender = req.senderId._id.toString() === userId.toString();
			return {
				...req,
				isSender,
				otherUser: isSender ? req.recipientId : req.senderId,
			};
		});

		res.status(200).json({
			success: true,
			requests: formattedRequests,
			count: formattedRequests.length,
		});
	} catch (error) {
		console.error("Get requests error:", error);
		res.status(500).json({ error: error.message });
	}
};

// ================= RESPOND TO REQUEST =================
export const respondToRequest = async (req, res) => {
	try {
		const { requestId, action } = req.body; // action: "approve" or "decline"
		const userId = req.user._id;

		const request = await Request.findById(requestId)
			.populate("senderId", "fullName email")
			.populate("recipientId", "fullName email");

		if (!request) {
			return res.status(404).json({ error: "Request not found" });
		}

		// Only recipient can respond
		if (request.recipientId._id.toString() !== userId.toString()) {
			return res.status(403).json({ error: "Not authorized" });
		}

		if (request.status !== "pending") {
			return res
				.status(400)
				.json({ error: `Request already ${request.status}` });
		}

		if (action === "approve") {
			request.status = "approved";
			await request.save();

			// Send notification to sender
			await sendPushToUser(
				request.senderId._id,
				"✅ Request Approved",
				`${request.recipientId.fullName} approved your request for ₦${request.amount.toLocaleString()}`,
				{
					type: "request_approved",
					requestId: request._id,
					recipientId: request.recipientId._id,
					amount: request.amount,
				},
			);

			res.json({
				success: true,
				message: "Request approved",
				request,
			});
		} else if (action === "decline") {
			request.status = "declined";
			await request.save();

			// Send notification to sender
			await sendPushToUser(
				request.senderId._id,
				"❌ Request Declined",
				`${request.recipientId.fullName} declined your request for ₦${request.amount.toLocaleString()}`,
				{
					type: "request_declined",
					requestId: request._id,
					recipientId: request.recipientId._id,
					amount: request.amount,
				},
			);

			res.json({
				success: true,
				message: "Request declined",
				request,
			});
		} else {
			res.status(400).json({ error: "Invalid action" });
		}
	} catch (error) {
		console.error("Respond to request error:", error);
		res.status(500).json({ error: error.message });
	}
};
