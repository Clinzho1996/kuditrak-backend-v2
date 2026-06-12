// backend/controllers/customerController.js
import mongoose from "mongoose";
import BankConnection from "../models/BankConnection.js";
import Budget from "../models/Budget.js";
import Notification from "../models/Notification.js";
import SavingsBucket from "../models/SavingsBucket.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { sendEmail } from "../services/emailService.js";
import { sendPush } from "../services/pushService.js";

// ===============================
// GET ALL CUSTOMERS
// ===============================
export const getAllCustomers = async (req, res) => {
	try {
		const { page = 1, limit = 20, search, status, plan } = req.query;

		let query = {};

		if (search) {
			query.$or = [
				{ fullName: { $regex: search, $options: "i" } },
				{ email: { $regex: search, $options: "i" } },
			];
		}

		if (status === "active") {
			query.isVerified = true;
		} else if (status === "pending") {
			query.isVerified = false;
		}

		if (plan && plan !== "all") {
			query["subscription.plan"] = plan;
		}

		const skip = (page - 1) * limit;

		const [users, total] = await Promise.all([
			User.find(query)
				.select("-password -otp -resetOtp")
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(parseInt(limit)),
			User.countDocuments(query),
		]);

		// Get additional stats for each user
		const usersWithStats = await Promise.all(
			users.map(async (user) => {
				const [transactionCount, budgetCount, savingsCount, bankCount] =
					await Promise.all([
						Transaction.countDocuments({ userId: user._id }),
						Budget.countDocuments({ userId: user._id }),
						SavingsBucket.countDocuments({ userId: user._id }),
						BankConnection.countDocuments({
							userId: user._id,
							status: "Active",
						}),
					]);

				return {
					...user.toObject(),
					stats: {
						transactions: transactionCount,
						budgets: budgetCount,
						savings: savingsCount,
						bankConnections: bankCount,
					},
				};
			}),
		);

		res.json({
			success: true,
			data: usersWithStats,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (err) {
		console.error("Get all customers error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// GET CUSTOMER BY ID
// ===============================
export const getCustomerById = async (req, res) => {
	try {
		const { id } = req.params;

		const user = await User.findById(id).select("-password -otp -resetOtp");

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		// Get all user data
		const [transactions, budgets, savings, bankConnections, notifications] =
			await Promise.all([
				Transaction.find({ userId: user._id })
					.sort({ createdAt: -1 })
					.limit(50),
				Budget.find({ userId: user._id }),
				SavingsBucket.find({ userId: user._id }),
				BankConnection.find({ userId: user._id }),
				Notification.find({ userId: user._id })
					.sort({ created_at: -1 })
					.limit(50),
			]);

		// Calculate financial summary
		const totalIncome = transactions
			.filter((t) => t.type === "income")
			.reduce((sum, t) => sum + t.amount, 0);

		const totalExpenses = transactions
			.filter((t) => t.type === "expense")
			.reduce((sum, t) => sum + t.amount, 0);

		res.json({
			success: true,
			data: {
				profile: user,
				financial: {
					totalIncome,
					totalExpenses,
					netSavings: totalIncome - totalExpenses,
					transactionCount: transactions.length,
					budgetCount: budgets.length,
					savingsCount: savings.length,
					bankCount: bankConnections.length,
				},
				recentTransactions: transactions,
				budgets,
				savings,
				bankConnections,
				recentNotifications: notifications,
			},
		});
	} catch (err) {
		console.error("Get customer by id error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// SUSPEND CUSTOMER
// ===============================
export const suspendCustomer = async (req, res) => {
	try {
		const { id } = req.params;
		const { reason } = req.body;

		const user = await User.findById(id);

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		user.isSuspended = true;
		user.suspendedAt = new Date();
		user.suspensionReason = reason || "No reason provided";
		await user.save();

		// Send email notification
		try {
			await sendEmail({
				to: user.email,
				subject: "Account Suspended - Kuditrak",
				html: `
          <h2>Account Suspended</h2>
          <p>Hello ${user.fullName},</p>
          <p>Your Kuditrak account has been suspended.</p>
          <p>Reason: ${reason || "Violation of terms of service"}</p>
          <p>If you believe this is a mistake, please contact support.</p>
          <br/>
          <p>Best regards,<br/>Kuditrak Team</p>
        `,
			});
		} catch (emailError) {
			console.error("Failed to send suspension email:", emailError);
		}

		// Send push notification if user has tokens
		if (user.pushTokens && user.pushTokens.length > 0) {
			try {
				const tokens = user.pushTokens.map((t) => t.token);
				await sendPush(tokens, {
					title: "Account Suspended",
					body: "Your Kuditrak account has been suspended. Contact support for details.",
					data: { type: "account", action: "suspended" },
				});
			} catch (pushError) {
				console.error("Failed to send suspension push:", pushError);
			}
		}

		res.json({
			success: true,
			message: "Customer suspended successfully",
			data: {
				id: user._id,
				email: user.email,
				suspended: true,
			},
		});
	} catch (err) {
		console.error("Suspend customer error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// ACTIVATE CUSTOMER
// ===============================
export const activateCustomer = async (req, res) => {
	try {
		const { id } = req.params;

		const user = await User.findById(id);

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		user.isSuspended = false;
		user.suspendedAt = null;
		user.suspensionReason = null;
		await user.save();

		// Send email notification
		try {
			await sendEmail({
				to: user.email,
				subject: "Account Activated - Kuditrak",
				html: `
          <h2>Account Activated</h2>
          <p>Hello ${user.fullName},</p>
          <p>Your Kuditrak account has been reactivated.</p>
          <p>You can now log in and continue using our services.</p>
          <br/>
          <p>Best regards,<br/>Kuditrak Team</p>
        `,
			});
		} catch (emailError) {
			console.error("Failed to send activation email:", emailError);
		}

		// Send push notification if user has tokens
		if (user.pushTokens && user.pushTokens.length > 0) {
			try {
				const tokens = user.pushTokens.map((t) => t.token);
				await sendPush(tokens, {
					title: "Account Activated",
					body: "Your Kuditrak account has been reactivated. Welcome back!",
					data: { type: "account", action: "activated" },
				});
			} catch (pushError) {
				console.error("Failed to send activation push:", pushError);
			}
		}

		res.json({
			success: true,
			message: "Customer activated successfully",
			data: {
				id: user._id,
				email: user.email,
				activated: true,
			},
		});
	} catch (err) {
		console.error("Activate customer error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// DELETE CUSTOMER
// ===============================
export const deleteCustomer = async (req, res) => {
	try {
		const { id } = req.params;
		const { reason } = req.body;

		const user = await User.findById(id);

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		// Store email before deletion for notification
		const userEmail = user.email;
		const userName = user.fullName;

		// Delete all user data
		await Promise.all([
			Transaction.deleteMany({ userId: user._id }),
			Budget.deleteMany({ userId: user._id }),
			SavingsBucket.deleteMany({ userId: user._id }),
			BankConnection.deleteMany({ userId: user._id }),
			Notification.deleteMany({ userId: user._id }),
			User.deleteOne({ _id: user._id }),
		]);

		// Send farewell email
		try {
			await sendEmail({
				to: userEmail,
				subject: "Account Deleted - Kuditrak",
				html: `
          <h2>Account Deleted</h2>
          <p>Hello ${userName},</p>
          <p>Your Kuditrak account has been permanently deleted.</p>
          <p>Reason: ${reason || "Requested by user or admin"}</p>
          <p>All your data has been removed from our systems.</p>
          <br/>
          <p>Thank you for using Kuditrak.</p>
        `,
			});
		} catch (emailError) {
			console.error("Failed to send deletion email:", emailError);
		}

		res.json({
			success: true,
			message: "Customer deleted successfully",
			data: {
				email: userEmail,
				deleted: true,
			},
		});
	} catch (err) {
		console.error("Delete customer error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// SEND MESSAGE TO CUSTOMER (Email)
// ===============================
export const sendMessageToCustomer = async (req, res) => {
	try {
		const { id } = req.params;
		const { subject, message } = req.body;

		if (!subject || !message) {
			return res
				.status(400)
				.json({ error: "Subject and message are required" });
		}

		const user = await User.findById(id);

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		// Send email
		await sendEmail({
			to: user.email,
			subject: subject,
			html: `
        <h2>${subject}</h2>
        <p>Hello ${user.fullName},</p>
        <div>${message}</div>
        <br/>
        <p>Best regards,<br/>Kuditrak Team</p>
        <hr/>
        <p style="font-size: 12px; color: #666;">This is an automated message from Kuditrak. Please do not reply.</p>
      `,
		});

		// Create notification in app
		await Notification.create({
			userId: user._id,
			title: subject,
			body: message,
			type: "system",
			data: { from: "admin" },
			created_at: new Date(),
		});

		res.json({
			success: true,
			message: "Message sent successfully",
			data: {
				to: user.email,
				subject,
				sentAt: new Date(),
			},
		});
	} catch (err) {
		console.error("Send message error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// SEND PUSH NOTIFICATION TO CUSTOMER
// ===============================
export const sendPushToCustomer = async (req, res) => {
	try {
		const { id } = req.params;
		const { title, body, data } = req.body;

		if (!title || !body) {
			return res.status(400).json({ error: "Title and body are required" });
		}

		const user = await User.findById(id);

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		let pushesSent = 0;

		// Send push notification
		if (user.pushTokens && user.pushTokens.length > 0) {
			const tokens = user.pushTokens.map((t) => t.token);
			await sendPush(tokens, { title, body, data: { type: "admin", ...data } });
			pushesSent = tokens.length;
		}

		// Create notification in app
		await Notification.create({
			userId: user._id,
			title,
			body,
			type: "system",
			data: { from: "admin", ...data },
			created_at: new Date(),
		});

		res.json({
			success: true,
			message: `Push notification sent to ${pushesSent} device(s)`,
			data: {
				title,
				body,
				pushesSent,
				inAppNotification: true,
			},
		});
	} catch (err) {
		console.error("Send push to customer error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// RESEND VERIFICATION EMAIL
// ===============================
export const resendVerificationEmail = async (req, res) => {
	try {
		const { id } = req.params;

		const user = await User.findById(id);

		if (!user) {
			return res.status(404).json({ error: "Customer not found" });
		}

		if (user.isVerified) {
			return res.status(400).json({ error: "User already verified" });
		}

		// Generate new OTP
		const otp = Math.floor(100000 + Math.random() * 900000);
		user.otp = otp;
		user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
		await user.save();

		// Send email
		await sendEmail({
			to: user.email,
			subject: "Verify Your Kuditrak Account",
			html: `
        <h2>Email Verification</h2>
        <p>Hello ${user.fullName},</p>
        <p>Your verification code is:</p>
        <h1 style="font-size: 32px; letter-spacing: 5px;">${otp}</h1>
        <p>This code expires in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <br/>
        <p>Best regards,<br/>Kuditrak Team</p>
      `,
		});

		res.json({
			success: true,
			message: "Verification email sent successfully",
			data: {
				email: user.email,
				otpSent: true,
			},
		});
	} catch (err) {
		console.error("Resend verification email error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// GET CUSTOMER STATS (Dashboard)
// ===============================
export const getCustomerStats = async (req, res) => {
	try {
		const now = new Date();
		const startOfDay = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		);
		const startOfWeek = new Date(now.setDate(now.getDate() - 7));
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

		const [
			totalUsers,
			verifiedUsers,
			unverifiedUsers,
			newToday,
			newThisWeek,
			newThisMonth,
			suspendedUsers,
		] = await Promise.all([
			User.countDocuments(),
			User.countDocuments({ isVerified: true }),
			User.countDocuments({ isVerified: false }),
			User.countDocuments({ createdAt: { $gte: startOfDay } }),
			User.countDocuments({ createdAt: { $gte: startOfWeek } }),
			User.countDocuments({ createdAt: { $gte: startOfMonth } }),
			User.countDocuments({ isSuspended: true }),
		]);

		// Subscription breakdown
		const [free, basic, pro] = await Promise.all([
			User.countDocuments({ "subscription.plan": "free" }),
			User.countDocuments({ "subscription.plan": "basic" }),
			User.countDocuments({ "subscription.plan": "pro" }),
		]);

		res.json({
			success: true,
			data: {
				total: totalUsers,
				verified: verifiedUsers,
				unverified: unverifiedUsers,
				suspended: suspendedUsers,
				new: {
					today: newToday,
					thisWeek: newThisWeek,
					thisMonth: newThisMonth,
				},
				subscriptions: {
					free,
					basic,
					pro,
					conversionRate: totalUsers
						? (((basic + pro) / totalUsers) * 100).toFixed(1)
						: 0,
				},
			},
		});
	} catch (err) {
		console.error("Get customer stats error:", err);
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/customerController.js

// ===============================
// BULK SUSPEND CUSTOMERS
// ===============================
export const bulkSuspendCustomers = async (req, res) => {
	try {
		const { userIds, reason } = req.body;

		if (!userIds || !userIds.length) {
			return res.status(400).json({ error: "User IDs are required" });
		}

		const result = await User.updateMany(
			{ _id: { $in: userIds } },
			{
				$set: {
					isSuspended: true,
					suspendedAt: new Date(),
					suspensionReason: reason || "Bulk suspension",
				},
			},
		);

		res.json({
			success: true,
			message: `${result.modifiedCount} users suspended`,
			modifiedCount: result.modifiedCount,
		});
	} catch (err) {
		console.error("Bulk suspend error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// BULK ACTIVATE CUSTOMERS
// ===============================
export const bulkActivateCustomers = async (req, res) => {
	try {
		const { userIds } = req.body;

		if (!userIds || !userIds.length) {
			return res.status(400).json({ error: "User IDs are required" });
		}

		const result = await User.updateMany(
			{ _id: { $in: userIds } },
			{
				$set: {
					isSuspended: false,
					suspendedAt: null,
					suspensionReason: null,
				},
			},
		);

		res.json({
			success: true,
			message: `${result.modifiedCount} users activated`,
			modifiedCount: result.modifiedCount,
		});
	} catch (err) {
		console.error("Bulk activate error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// BULK DELETE CUSTOMERS
// ===============================
export const bulkDeleteCustomers = async (req, res) => {
	try {
		const { userIds, reason } = req.body;

		if (!userIds || !userIds.length) {
			return res.status(400).json({ error: "User IDs are required" });
		}

		// Get users before deletion for email notifications
		const users = await User.find({ _id: { $in: userIds } });

		// Delete all user data
		for (const user of users) {
			await Promise.all([
				Transaction.deleteMany({ userId: user._id }),
				Budget.deleteMany({ userId: user._id }),
				SavingsBucket.deleteMany({ userId: user._id }),
				BankConnection.deleteMany({ userId: user._id }),
				Notification.deleteMany({ userId: user._id }),
			]);
		}

		// Delete users
		const result = await User.deleteMany({ _id: { $in: userIds } });

		// Send farewell emails (fire and forget)
		for (const user of users) {
			sendEmail({
				to: user.email,
				subject: "Account Deleted - Kuditrak",
				html: `<p>Your Kuditrak account has been deleted. Reason: ${reason || "Admin action"}</p>`,
			}).catch(console.error);
		}

		res.json({
			success: true,
			message: `${result.deletedCount} users deleted`,
			deletedCount: result.deletedCount,
		});
	} catch (err) {
		console.error("Bulk delete error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// BULK SEND PUSH NOTIFICATION
// ===============================
export const bulkSendPush = async (req, res) => {
	try {
		const { userIds, title, body, data } = req.body;

		if (!title || !body) {
			return res.status(400).json({ error: "Title and body are required" });
		}

		let users;
		if (userIds && userIds.length) {
			users = await User.find({ _id: { $in: userIds } });
		} else {
			users = await User.find({ pushTokens: { $exists: true, $ne: [] } });
		}

		let pushesSent = 0;
		let notificationsCreated = 0;

		for (const user of users) {
			// Create in-app notification
			await Notification.create({
				userId: user._id,
				title,
				body,
				type: "system",
				data: { from: "admin", ...data },
				created_at: new Date(),
			});
			notificationsCreated++;

			// Send push notification
			if (user.pushTokens && user.pushTokens.length > 0) {
				const tokens = user.pushTokens.map((t) => t.token);
				await sendPush(tokens, {
					title,
					body,
					data: { type: "admin", ...data },
				});
				pushesSent += tokens.length;
			}
		}

		res.json({
			success: true,
			message: `Sent to ${users.length} users`,
			notificationsCreated,
			pushesSent,
		});
	} catch (err) {
		console.error("Bulk push error:", err);
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/exportController.js

// ===============================
// EXPORT ALL USERS DATA (CSV)
// ===============================
export const exportAllUsers = async (req, res) => {
	try {
		const users = await User.find({}).select("-password -otp -resetOtp");

		const csvRows = [
			[
				"ID",
				"Name",
				"Email",
				"Plan",
				"Status",
				"Verified",
				"Created At",
				"Last Login",
			],
		];

		for (const user of users) {
			csvRows.push([
				user._id,
				user.fullName,
				user.email,
				user.subscription?.plan || "free",
				user.isSuspended ? "Suspended" : "Active",
				user.isVerified ? "Yes" : "No",
				new Date(user.createdAt).toISOString(),
				user.lastLogin ? new Date(user.lastLogin).toISOString() : "Never",
			]);
		}

		const csv = csvRows.map((row) => row.join(",")).join("\n");

		res.setHeader("Content-Type", "text/csv");
		res.setHeader(
			"Content-Disposition",
			"attachment; filename=kuditrak_users.csv",
		);
		res.send(csv);
	} catch (err) {
		console.error("Export users error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// EXPORT USER DATA (Single user)
// ===============================
export const exportUserData = async (req, res) => {
	try {
		const { id } = req.params;

		const [user, transactions, budgets, savings] = await Promise.all([
			User.findById(id).select("-password -otp -resetOtp"),
			Transaction.find({ userId: id }),
			Budget.find({ userId: id }),
			SavingsBucket.find({ userId: id }),
		]);

		const exportData = {
			user,
			transactions,
			budgets,
			savings,
			exportDate: new Date(),
			summary: {
				totalIncome: transactions
					.filter((t) => t.type === "income")
					.reduce((s, t) => s + t.amount, 0),
				totalExpenses: transactions
					.filter((t) => t.type === "expense")
					.reduce((s, t) => s + t.amount, 0),
				totalBudgets: budgets.length,
				totalSavings: savings.length,
			},
		};

		res.json({
			success: true,
			data: exportData,
		});
	} catch (err) {
		console.error("Export user data error:", err);
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/healthController.js

// ===============================
// SYSTEM HEALTH CHECK
// ===============================
export const systemHealth = async (req, res) => {
	try {
		const dbState = mongoose.connection.readyState;
		const dbStatus = {
			0: "disconnected",
			1: "connected",
			2: "connecting",
			3: "disconnecting",
		};

		const now = new Date();
		const uptime = process.uptime();

		res.json({
			success: true,
			data: {
				status: "healthy",
				timestamp: now,
				uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
				database: {
					status: dbStatus[dbState],
					connected: dbState === 1,
				},
				memory: process.memoryUsage(),
				version: process.version,
			},
		});
	} catch (err) {
		console.error("Health check error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// SYSTEM METRICS
// ===============================
export const systemMetrics = async (req, res) => {
	try {
		const now = new Date();
		const startOfDay = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		);

		const [
			totalUsers,
			activeToday,
			totalTransactions,
			totalRevenue,
			pendingVerifications,
		] = await Promise.all([
			User.countDocuments(),
			User.countDocuments({ lastLogin: { $gte: startOfDay } }),
			Transaction.countDocuments(),
			Transaction.aggregate([
				{ $match: { type: "income" } },
				{ $group: { _id: null, total: { $sum: "$amount" } } },
			]),
			User.countDocuments({ isVerified: false }),
		]);

		res.json({
			success: true,
			data: {
				users: {
					total: totalUsers,
					activeToday,
					pendingVerification: pendingVerifications,
				},
				transactions: {
					total: totalTransactions,
					totalRevenue: totalRevenue[0]?.total || 0,
				},
				performance: {
					avgResponseTime: "~200ms",
					uptime: process.uptime(),
				},
			},
		});
	} catch (err) {
		console.error("System metrics error:", err);
		res.status(500).json({ error: err.message });
	}
};
