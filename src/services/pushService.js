// backend/services/pushService.js
import { Expo } from "expo-server-sdk";
import User from "../models/User.js";

// Create a new Expo SDK client
const expo = new Expo();

// Send push notification to a specific user
export const sendPushToUser = async (userId, title, body, data = {}) => {
	try {
		console.log(`📱 Sending push to user: ${userId}`);
		console.log(`Title: ${title}`);
		console.log(`Body: ${body}`);

		// Find user with push tokens (not deviceTokens)
		const user = await User.findById(userId).select(
			"pushTokens email fullName",
		);

		if (!user) {
			console.log(`❌ User not found: ${userId}`);
			return { success: false, message: "User not found" };
		}

		// Check pushTokens array (not deviceTokens)
		if (!user.pushTokens || user.pushTokens.length === 0) {
			console.log(`❌ No push tokens for user: ${user.email}`);
			return { success: false, message: "No device tokens" };
		}

		console.log(
			`✅ Found ${user.pushTokens.length} push token(s) for ${user.email}`,
		);

		const messages = [];
		const validTokens = [];

		// Prepare messages for each valid token
		for (const pushToken of user.pushTokens) {
			console.log(`Checking token: ${pushToken.token.substring(0, 30)}...`);

			// Check if it's a valid Expo push token
			if (!Expo.isExpoPushToken(pushToken.token)) {
				console.log(`❌ Invalid Expo push token: ${pushToken.token}`);
				continue;
			}

			validTokens.push(pushToken.token);

			messages.push({
				to: pushToken.token,
				sound: "default",
				title: title,
				body: body,
				data: {
					...data,
					userId: user._id.toString(),
					timestamp: new Date().toISOString(),
				},
				priority: "high",
			});
		}

		if (messages.length === 0) {
			console.log("❌ No valid Expo push tokens found");
			return { success: false, message: "No valid tokens" };
		}

		console.log(`📤 Sending ${messages.length} push notification(s)...`);

		// Send notifications in chunks
		const chunks = expo.chunkPushNotifications(messages);
		const tickets = [];
		const errors = [];

		for (const chunk of chunks) {
			try {
				const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
				tickets.push(...ticketChunk);

				// Check for errors in tickets
				ticketChunk.forEach((ticket, index) => {
					if (ticket.status === "error") {
						console.log(`Ticket error: ${ticket.message}`);
						errors.push({
							token: messages[index]?.to,
							error: ticket.message,
						});

						// If token is invalid, remove it from database
						if (ticket.message === "DeviceNotRegistered") {
							console.log(`Removing invalid token: ${messages[index]?.to}`);
							User.findByIdAndUpdate(user._id, {
								$pull: { pushTokens: { token: messages[index]?.to } },
							});
						}
					}
				});
			} catch (error) {
				console.error("Error sending chunk:", error);
				errors.push({ error: error.message });
			}
		}

		console.log(
			`✅ Push sent: ${messages.length - errors.length} successful, ${errors.length} failed`,
		);

		return {
			success: true,
			sent: messages.length - errors.length,
			failed: errors.length,
			errors: errors.length > 0 ? errors : undefined,
		};
	} catch (error) {
		console.error("❌ Error sending push notification:", error);
		throw error;
	}
};

// Save push token for user (updated for pushTokens)
export const saveDeviceToken = async (
	userId,
	token,
	deviceType,
	deviceId = null,
) => {
	try {
		console.log(`💾 Saving push token for user: ${userId}`);

		const user = await User.findById(userId);

		if (!user) {
			throw new Error("User not found");
		}

		// Initialize pushTokens array if it doesn't exist
		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// Remove this token from any other user first (cleanup)
		await User.updateMany(
			{ "pushTokens.token": token },
			{ $pull: { pushTokens: { token: token } } },
		);

		// Check if token already exists for this user
		const existingToken = user.pushTokens.find((t) => t.token === token);

		if (existingToken) {
			existingToken.lastUsed = new Date();
			existingToken.platform = deviceType;
			if (deviceId) existingToken.deviceId = deviceId;
		} else {
			user.pushTokens.push({
				token,
				platform: deviceType,
				deviceId: deviceId,
				lastUsed: new Date(),
				createdAt: new Date(),
			});
		}

		await user.save();
		console.log(`✅ Push token saved for ${user.email}`);

		return user;
	} catch (error) {
		console.error("Error saving push token:", error);
		throw error;
	}
};

// Remove push token
export const removeDeviceToken = async (userId, token) => {
	try {
		const result = await User.findByIdAndUpdate(
			userId,
			{ $pull: { pushTokens: { token: token } } },
			{ new: true },
		);

		console.log(`✅ Push token removed for user ${userId}`);
		return result;
	} catch (error) {
		console.error("Error removing push token:", error);
		throw error;
	}
};

// Remove all push tokens for a user
export const removeAllDeviceTokens = async (userId) => {
	try {
		const result = await User.findByIdAndUpdate(
			userId,
			{ $set: { pushTokens: [] } },
			{ new: true },
		);

		console.log(`✅ All push tokens removed for user ${userId}`);
		return result;
	} catch (error) {
		console.error("Error removing all push tokens:", error);
		throw error;
	}
};

// Legacy sendPush function (keep for backward compatibility)
// backend/services/pushService.js - Update sendPush function
export const sendPush = async (tokens, { title, body, data = {} }) => {
	try {
		if (!tokens || tokens.length === 0) {
			return { success: false, message: "No tokens provided" };
		}

		const messages = [];
		const validTokens = [];
		const invalidTokens = [];

		for (const token of tokens) {
			if (!Expo.isExpoPushToken(token)) {
				console.log(`Invalid push token: ${token}`);
				invalidTokens.push(token);
				continue;
			}
			validTokens.push(token);
			messages.push({
				to: token,
				sound: "default",
				title: title,
				body: body,
				data: data,
				priority: "high",
			});
		}

		if (messages.length === 0) {
			return {
				success: false,
				message: "No valid tokens",
				invalidTokens: invalidTokens.length,
			};
		}

		const chunks = expo.chunkPushNotifications(messages);
		const tickets = [];

		for (const chunk of chunks) {
			try {
				const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
				tickets.push(...ticketChunk);
			} catch (error) {
				console.error("Error sending chunk:", error);
			}
		}

		return {
			success: true,
			sent: messages.length,
			invalid: invalidTokens.length,
			tickets: tickets,
		};
	} catch (error) {
		console.error("Error sending push:", error);
		throw error;
	}
};
