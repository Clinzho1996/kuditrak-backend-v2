// controllers/requestController.js
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
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
// controllers/requestController.js - Fixed respondToRequest

export const respondToRequest = async (req, res) => {
	try {
		const { requestId, action } = req.body;
		const userId = req.user._id;

		console.log("📥 Responding to request:", { requestId, action, userId });

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
			// ✅ TRANSFER MONEY - FIX HERE
			const senderId = request.senderId._id;
			const recipientId = request.recipientId._id;
			const amount = request.amount;

			console.log(
				`💰 Processing transfer: ₦${amount} from ${senderId} to ${recipientId}`,
			);

			// ✅ Get sender's wallet (the person who requested money)
			const senderWallet = await AnchorWallet.findOne({
				userId: senderId,
				walletType: "main",
			});

			// ✅ Get recipient's wallet (the person who is approving)
			const recipientWallet = await AnchorWallet.findOne({
				userId: recipientId,
				walletType: "main",
			});

			if (!senderWallet) {
				return res.status(404).json({
					error: "Sender wallet not found",
					message: "The person who requested money doesn't have a wallet",
				});
			}

			if (!recipientWallet) {
				return res.status(404).json({
					error: "Recipient wallet not found",
					message: "Your wallet not found",
				});
			}

			// ✅ Check if sender has enough balance
			if (senderWallet.balance < amount) {
				return res.status(400).json({
					error: "Insufficient balance",
					message: `${request.senderId.fullName} doesn't have enough balance to fulfill this request. Available: ₦${senderWallet.balance.toLocaleString()}`,
					available: senderWallet.balance,
					required: amount,
				});
			}

			// ✅ Perform the transfer
			// Deduct from sender (the requester)
			senderWallet.balance -= amount;
			senderWallet.available =
				senderWallet.balance - (senderWallet.allocated || 0);
			await senderWallet.save();

			// Add to recipient (the approver)
			recipientWallet.balance += amount;
			recipientWallet.available =
				recipientWallet.balance - (recipientWallet.allocated || 0);
			await recipientWallet.save();

			console.log(`✅ Transfer complete: ₦${amount} moved`);

			// ✅ Create transaction record for sender (debit)
			await AnchorTransaction.create({
				userId: senderId,
				anchorCustomerId: senderWallet.anchorCustomerId,
				walletId: senderWallet._id,
				amount: amount,
				currency: "NGN",
				type: "debit",
				category: "transfer",
				status: "success",
				description: `Money request approved by ${request.recipientId.fullName}`,
				source: "request",
				destination: "wallet",
				metadata: {
					requestId: request._id,
					recipientId: recipientId,
					recipientName: request.recipientId.fullName,
					isRequestApproval: true,
					reference: request.reference,
				},
			});

			// ✅ Create transaction record for recipient (credit)
			await AnchorTransaction.create({
				userId: recipientId,
				anchorCustomerId: recipientWallet.anchorCustomerId,
				walletId: recipientWallet._id,
				amount: amount,
				currency: "NGN",
				type: "credit",
				category: "transfer",
				status: "success",
				description: `Money request from ${request.senderId.fullName} approved`,
				source: "request",
				destination: "wallet",
				metadata: {
					requestId: request._id,
					senderId: senderId,
					senderName: request.senderId.fullName,
					isRequestApproval: true,
					reference: request.reference,
				},
			});

			// ✅ Update request status
			request.status = "approved";
			request.respondedAt = new Date();
			await request.save();

			// ✅ Send push notification to sender
			await sendPushToUser(
				senderId,
				"✅ Request Approved",
				`${request.recipientId.fullName} approved your request for ₦${amount.toLocaleString()}`,
				{
					type: "request_approved",
					requestId: request._id,
					recipientId: recipientId,
					amount: amount,
					newBalance: senderWallet.balance,
				},
			);

			// ✅ Send push notification to recipient
			await sendPushToUser(
				recipientId,
				"💰 Money Sent",
				`You sent ₦${amount.toLocaleString()} to ${request.senderId.fullName}`,
				{
					type: "money_sent",
					amount: amount,
					recipientId: senderId,
					recipientName: request.senderId.fullName,
					newBalance: recipientWallet.balance,
				},
			);

			// ✅ Send email notifications
			try {
				const { sendRequestApprovedEmail, sendMoneySentEmail } =
					await import("../utils/emailService.js");

				// Send email to sender (requester) - they received the money
				await sendRequestApprovedEmail({
					requesterEmail: request.senderId.email,
					requesterName: request.senderId.fullName,
					approverName: request.recipientId.fullName,
					amount: amount,
					requestId: request._id,
					reference: request.reference,
				});

				// Send email to recipient (approver) - they sent the money
				await sendMoneySentEmail({
					senderEmail: request.recipientId.email,
					senderName: request.recipientId.fullName,
					recipientName: request.senderId.fullName,
					amount: amount,
					reference: request.reference,
				});
			} catch (emailError) {
				console.error("Email error:", emailError);
			}

			res.json({
				success: true,
				message: `Request approved and ₦${amount.toLocaleString()} transferred successfully`,
				request,
				transfer: {
					amount: amount,
					from: request.senderId.fullName,
					to: request.recipientId.fullName,
					senderNewBalance: senderWallet.balance,
					recipientNewBalance: recipientWallet.balance,
				},
			});
		} else if (action === "decline") {
			// ✅ Simply decline the request - no money moves
			request.status = "declined";
			request.respondedAt = new Date();
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
		console.error("❌ Respond to request error:", error);
		res.status(500).json({ error: error.message });
	}
};
