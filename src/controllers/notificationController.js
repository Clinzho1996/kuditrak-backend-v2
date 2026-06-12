// backend/controllers/notificationController.js
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { sendPush } from "../services/pushService.js";

// ===============================
// GET USER NOTIFICATIONS
// ===============================
export const getNotifications = async (req, res) => {
	try {
		const userId = req.user._id;
		const { page = 1, limit = 20, unread_only = false } = req.query;

		const query = { userId };
		if (unread_only === "true") {
			query.is_read = false;
		}

		const notifications = await Notification.find(query)
			.sort({ created_at: -1 })
			.skip((page - 1) * limit)
			.limit(parseInt(limit));

		const total = await Notification.countDocuments(query);
		const unreadCount = await Notification.countDocuments({
			userId,
			is_read: false,
		});

		res.status(200).json({
			success: true,
			data: notifications,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
			unreadCount,
		});
	} catch (err) {
		console.error("Get notifications error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// MARK NOTIFICATION AS READ
// ===============================
export const markAsRead = async (req, res) => {
	try {
		const userId = req.user._id;
		const { id } = req.params;

		const notification = await Notification.findOneAndUpdate(
			{ _id: id, userId },
			{
				is_read: true,
				read_at: new Date(),
			},
			{ new: true },
		);

		if (!notification) {
			return res.status(404).json({ error: "Notification not found" });
		}

		res.status(200).json({
			success: true,
			data: notification,
		});
	} catch (err) {
		console.error("Mark as read error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// MARK ALL AS READ
// ===============================
export const markAllAsRead = async (req, res) => {
	try {
		const userId = req.user._id;

		await Notification.updateMany(
			{ userId, is_read: false },
			{
				is_read: true,
				read_at: new Date(),
			},
		);

		res.status(200).json({
			success: true,
			message: "All notifications marked as read",
		});
	} catch (err) {
		console.error("Mark all as read error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// DELETE NOTIFICATION
// ===============================
export const deleteNotification = async (req, res) => {
	try {
		const userId = req.user._id;
		const { id } = req.params;

		const notification = await Notification.findOneAndDelete({
			_id: id,
			userId,
		});

		if (!notification) {
			return res.status(404).json({ error: "Notification not found" });
		}

		res.status(200).json({
			success: true,
			message: "Notification deleted",
		});
	} catch (err) {
		console.error("Delete notification error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// REGISTER PUSH TOKEN
// ===============================
export const registerPushToken = async (req, res) => {
	try {
		const userId = req.user._id;
		const { token, platform, deviceId } = req.body;

		console.log("Registering push token:", { token, platform, deviceId });

		// VALIDATION: Ensure required fields
		if (!token) {
			return res.status(400).json({ error: "Token is required" });
		}

		if (!platform) {
			return res.status(400).json({ error: "Platform is required" });
		}

		// Validate token format
		if (!token.startsWith("ExponentPushToken")) {
			console.warn("Invalid token format:", token);
			return res.status(400).json({ error: "Invalid Expo push token format" });
		}

		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Initialize pushTokens array if it doesn't exist
		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// CLEANUP: Remove any malformed entries for this user
		const originalCount = user.pushTokens.length;
		user.pushTokens = user.pushTokens.filter(
			(t) =>
				t &&
				t.token &&
				typeof t.token === "string" &&
				t.token.startsWith("ExponentPushToken") &&
				t.platform,
		);

		if (originalCount !== user.pushTokens.length) {
			console.log(
				`🧹 Cleaned up ${originalCount - user.pushTokens.length} malformed tokens`,
			);
		}

		// Handle deviceId (ensure it's a string)
		let deviceIdString = null;
		if (deviceId) {
			if (typeof deviceId === "object") {
				deviceIdString = deviceId.data || deviceId.token || null;
			} else if (typeof deviceId === "string") {
				deviceIdString = deviceId;
			} else {
				deviceIdString = String(deviceId);
			}
		}

		// Check if token already exists
		const existingTokenIndex = user.pushTokens.findIndex(
			(t) => t.token === token,
		);

		if (existingTokenIndex !== -1) {
			// Update existing token - preserve all fields
			user.pushTokens[existingTokenIndex] = {
				...user.pushTokens[existingTokenIndex],
				token: token,
				platform: platform,
				deviceId:
					deviceIdString || user.pushTokens[existingTokenIndex].deviceId,
				lastUsed: new Date(),
				// Preserve original createdAt if it exists
				createdAt: user.pushTokens[existingTokenIndex].createdAt || new Date(),
			};
		} else {
			// Add new token with ALL required fields
			user.pushTokens.push({
				token: token,
				platform: platform,
				deviceId: deviceIdString,
				createdAt: new Date(),
				lastUsed: new Date(),
			});
		}

		await user.save();

		console.log(
			`✅ Push token registered for user ${userId}, total tokens: ${user.pushTokens.length}`,
		);

		res.status(200).json({
			success: true,
			message: "Push token registered successfully",
			data: {
				tokenCount: user.pushTokens.length,
			},
		});
	} catch (err) {
		console.error("Register push token error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// UNREGISTER PUSH TOKEN
// ===============================
export const unregisterPushToken = async (req, res) => {
	try {
		const userId = req.user._id;
		const { token } = req.body;

		if (!token) {
			return res.status(400).json({ error: "Token is required" });
		}

		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// Remove the token
		user.pushTokens = user.pushTokens.filter((t) => t.token !== token);

		await user.save();

		res.status(200).json({
			success: true,
			message: "Push token unregistered",
		});
	} catch (err) {
		console.error("Unregister push token error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// CLEANUP INVALID PUSH TOKENS (Admin)
// ===============================
export const cleanupInvalidPushTokens = async (req, res) => {
	try {
		const userId = req.user._id;

		// If admin or self cleanup
		const query = userId ? { _id: userId } : {};

		const users = await User.find(query);
		let totalCleaned = 0;

		for (const user of users) {
			if (!user.pushTokens || user.pushTokens.length === 0) continue;

			const originalCount = user.pushTokens.length;

			// Filter out malformed tokens
			user.pushTokens = user.pushTokens.filter(
				(token) =>
					token &&
					token.token &&
					typeof token.token === "string" &&
					token.token.startsWith("ExponentPushToken") &&
					token.platform &&
					(token.createdAt || token.lastUsed), // Must have at least one date
			);

			const cleaned = originalCount - user.pushTokens.length;
			if (cleaned > 0) {
				totalCleaned += cleaned;
				await user.save();
				console.log(`🧹 Cleaned ${cleaned} tokens for user ${user._id}`);
			}
		}

		res.status(200).json({
			success: true,
			message: `Cleaned up ${totalCleaned} invalid push tokens`,
			totalCleaned,
		});
	} catch (err) {
		console.error("Cleanup push tokens error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// UPDATE NOTIFICATION SETTINGS
// ===============================
export const updateNotificationSettings = async (req, res) => {
	try {
		const userId = req.user._id;
		const settings = req.body;

		const user = await User.findByIdAndUpdate(
			userId,
			{ notificationSettings: settings },
			{ new: true },
		).select("notificationSettings");

		res.status(200).json({
			success: true,
			data: user.notificationSettings,
		});
	} catch (err) {
		console.error("Update notification settings error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// GET NOTIFICATION SETTINGS
// ===============================
export const getNotificationSettings = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId).select("notificationSettings");

		res.status(200).json({
			success: true,
			data: user.notificationSettings,
		});
	} catch (err) {
		console.error("Get notification settings error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// CREATE NOTIFICATION (Admin/System)
// ===============================
// ===============================
// CREATE NOTIFICATION (Admin/System)
// ===============================
export const createNotification = async (req, res) => {
	try {
		const { userId, title, body, type, data, sendPush = true } = req.body;

		if (!userId || !title || !body) {
			return res.status(400).json({ error: "Missing required fields" });
		}

		const notification = await Notification.create({
			userId,
			title,
			body,
			type: type || "system",
			data: data || {},
			created_at: new Date(),
		});

		// Send push notification if enabled
		if (sendPush) {
			const user = await User.findById(userId);
			if (user && user.notificationSettings?.push_enabled !== false) {
				// Safely get tokens
				const tokens = user.pushTokens?.map((t) => t.token) || [];
				if (tokens.length > 0) {
					await sendPush(tokens, {
						title,
						body,
						data: {
							notificationId: notification._id.toString(),
							type,
							...data,
						},
					});
					notification.is_push_sent = true;
					await notification.save();
				}
			}
		}

		res.status(201).json({
			success: true,
			data: notification,
		});
	} catch (err) {
		console.error("Create notification error:", err);
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/notificationController.js - Add this endpoint

// ===============================
// SEND PUSH TO ALL USERS (Admin)
// ===============================
// backend/controllers/notificationController.js
export const sendPushToAllUsers = async (req, res) => {
	try {
		const { title, body, type, data } = req.body;

		if (!title || !body) {
			return res.status(400).json({
				success: false,
				error: "Title and body are required",
			});
		}

		// Use valid enum values from your model
		const validTypes = [
			"system",
			"budget_alert",
			"savings_goal",
			"subscription",
			"transaction",
			"investment",
			"general",
		];
		const notificationType = validTypes.includes(type) ? type : "system";

		// Find all users (not just those with push tokens) - so everyone gets notification in app
		const users = await User.find({});

		console.log(`📢 Sending notification to ${users.length} users`);
		console.log(`Title: ${title}`);
		console.log(`Body: ${body}`);
		console.log(`Type: ${notificationType}`);

		let notificationsCreated = 0;
		let pushesSent = 0;

		for (const user of users) {
			try {
				// Create notification record in database for EVERY user
				await Notification.create({
					userId: user._id,
					title,
					body,
					type: notificationType,
					data: data || {},
					created_at: new Date(),
				});
				notificationsCreated++;

				// Send push notification ONLY to users with valid push tokens
				if (user.pushTokens && user.pushTokens.length > 0) {
					const tokens = user.pushTokens.map((t) => t.token);
					await sendPush(tokens, {
						title,
						body,
						data: {
							type: notificationType,
							...data,
						},
					});
					pushesSent++;
				}
			} catch (userError) {
				console.error(`Error for user ${user._id}:`, userError.message);
			}
		}

		res.status(200).json({
			success: true,
			message: `Sent to ${users.length} users`,
			notificationsCreated,
			pushesSent,
		});
	} catch (err) {
		console.error("Send push to all users error:", err);
		res.status(500).json({ error: err.message });
	}
};
// ===============================
// SEND BULK NOTIFICATION (Admin)
// ===============================
export const sendBulkNotification = async (req, res) => {
	try {
		const { title, body, type, data, userFilter = {} } = req.body;

		if (!title || !body) {
			return res.status(400).json({ error: "Title and body are required" });
		}

		// Find users based on filter
		const users = await User.find({
			...userFilter,
			"notificationSettings.push_enabled": true,
		});

		const notifications = [];
		const pushTokens = [];

		for (const user of users) {
			// Create notification record
			const notification = await Notification.create({
				userId: user._id,
				title,
				body,
				type: type || "system",
				data: data || {},
			});
			notifications.push(notification);

			// Collect push tokens safely
			if (user.pushTokens && user.pushTokens.length > 0) {
				pushTokens.push(...user.pushTokens.map((t) => t.token));
			}
		}

		// Send push notifications
		if (pushTokens.length > 0) {
			await sendPush(pushTokens, {
				title,
				body,
				data: {
					type,
					...data,
				},
			});
		}

		res.status(201).json({
			success: true,
			message: `Sent to ${users.length} users`,
			count: users.length,
		});
	} catch (err) {
		console.error("Bulk notification error:", err);
		res.status(500).json({ error: err.message });
	}
};
