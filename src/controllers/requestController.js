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
			// ✅ CORRECT FLOW: Money moves FROM Approver TO Requester
			const requesterId = request.senderId._id; // Person who requested money (wants to receive)
			const approverId = request.recipientId._id; // Person who is approving (will send money)
			const amount = request.amount;

			console.log(
				`💰 Processing transfer: ₦${amount} from APPROVER (${approverId}) to REQUESTER (${requesterId})`,
			);

			// ✅ Get wallets
			const approverWallet = await AnchorWallet.findOne({
				userId: approverId,
				walletType: "main",
			});

			const requesterWallet = await AnchorWallet.findOne({
				userId: requesterId,
				walletType: "main",
			});

			if (!approverWallet) {
				return res.status(404).json({
					error: "Approver wallet not found",
					message: "Your wallet not found",
				});
			}

			if (!requesterWallet) {
				return res.status(404).json({
					error: "Requester wallet not found",
					message: "The person who requested money doesn't have a wallet",
				});
			}

			// ✅ Check if approver has enough balance
			if (approverWallet.balance < amount) {
				return res.status(400).json({
					error: "Insufficient balance",
					message: `You don't have enough balance to fulfill this request. Available: ₦${approverWallet.balance.toLocaleString()}`,
					available: approverWallet.balance,
					required: amount,
				});
			}

			// ✅ Perform the transfer (CORRECT DIRECTION)
			// DEBIT: Approver sends money (money leaves their wallet)
			approverWallet.balance -= amount;
			approverWallet.available =
				approverWallet.balance - (approverWallet.allocated || 0);
			await approverWallet.save();

			// CREDIT: Requester receives money (money enters their wallet)
			requesterWallet.balance += amount;
			requesterWallet.available =
				requesterWallet.balance - (requesterWallet.allocated || 0);
			await requesterWallet.save();

			console.log(
				`✅ Transfer complete: ₦${amount} moved from Approver to Requester`,
			);

			// ✅ Create transaction for Approver (DEBIT - money sent)
			await AnchorTransaction.create({
				userId: approverId,
				anchorCustomerId: approverWallet.anchorCustomerId,
				walletId: approverWallet._id,
				amount: amount,
				currency: "NGN",
				type: "debit",
				category: "transfer",
				status: "success",
				description: `Money request from ${request.senderId.fullName} approved`,
				source: "request",
				destination: "wallet",
				metadata: {
					requestId: request._id,
					senderId: requesterId,
					senderName: request.senderId.fullName,
					isRequestApproval: true,
					reference: request.reference,
					direction: "sent", // ✅ Marks that money was sent
				},
			});

			// ✅ Create transaction for Requester (CREDIT - money received)
			await AnchorTransaction.create({
				userId: requesterId,
				anchorCustomerId: requesterWallet.anchorCustomerId,
				walletId: requesterWallet._id,
				amount: amount,
				currency: "NGN",
				type: "credit",
				category: "transfer",
				status: "success",
				description: `Money request approved by ${request.recipientId.fullName}`,
				source: "request",
				destination: "wallet",
				metadata: {
					requestId: request._id,
					recipientId: approverId,
					recipientName: request.recipientId.fullName,
					isRequestApproval: true,
					reference: request.reference,
					direction: "received", // ✅ Marks that money was received
				},
			});

			// ✅ Update request status
			request.status = "approved";
			request.respondedAt = new Date();
			await request.save();

			// ✅ Send push notification to Requester (they received money)
			await sendPushToUser(
				requesterId,
				"💰 Money Received",
				`${request.recipientId.fullName} approved your request and sent ₦${amount.toLocaleString()}`,
				{
					type: "money_received",
					requestId: request._id,
					senderId: approverId,
					senderName: request.recipientId.fullName,
					amount: amount,
					newBalance: requesterWallet.balance,
				},
			);

			// ✅ Send push notification to Approver (they sent money)
			await sendPushToUser(
				approverId,
				"💸 Money Sent",
				`You sent ₦${amount.toLocaleString()} to ${request.senderId.fullName}`,
				{
					type: "money_sent",
					amount: amount,
					recipientId: requesterId,
					recipientName: request.senderId.fullName,
					newBalance: approverWallet.balance,
				},
			);

			// ✅ Send email notifications
			try {
				const {
					sendRequestApprovedEmail,
					sendMoneySentEmail,
					sendMoneyReceivedEmail,
				} = await import("../utils/emailService.js");

				// Email to Requester (they received money)
				await sendMoneyReceivedEmail({
					recipientEmail: request.senderId.email,
					recipientName: request.senderId.fullName,
					senderName: request.recipientId.fullName,
					amount: amount,
					reference: request.reference,
				});

				// Email to Approver (they sent money)
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
				message: `Request approved and ₦${amount.toLocaleString()} transferred to ${request.senderId.fullName}`,
				request,
				transfer: {
					amount: amount,
					from: request.recipientId.fullName, // Approver
					to: request.senderId.fullName, // Requester
					approverNewBalance: approverWallet.balance,
					requesterNewBalance: requesterWallet.balance,
				},
			});
		} else if (action === "decline") {
			request.status = "declined";
			request.respondedAt = new Date();
			await request.save();

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
