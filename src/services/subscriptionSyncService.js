// backend/services/subscriptionSyncService.js
import mongoose from "mongoose";
import User from "../models/User.js";

const REVENUECAT_API_KEY = process.env.REVENUECAT_API_KEY;
const REVENUECAT_API_URL = "https://api.revenuecat.com/v1";

// Fetch customer info using RevenueCat's App User ID
const fetchCustomerInfo = async (revenueCatAppUserId) => {
	try {
		const response = await fetch(
			`${REVENUECAT_API_URL}/subscribers/${revenueCatAppUserId}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${REVENUECAT_API_KEY}`,
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.ok) {
			throw new Error(`RevenueCat API error: ${response.status}`);
		}

		const data = await response.json();
		return data.subscriber;
	} catch (error) {
		console.error("Error fetching from RevenueCat:", error.message);
		throw error;
	}
};

// Update a user's subscription by their RevenueCat App User ID
export const syncUserSubscriptionByRevenueCatId = async (
	revenueCatAppUserId,
	retries = 3,
) => {
	try {
		console.log(
			`🔄 Syncing subscription for RevenueCat user: ${revenueCatAppUserId}`,
		);

		// Find user by their RevenueCat App User ID
		const user = await User.findOne({ revenueCatAppUserId });

		if (!user) {
			console.log(`No user found with RevenueCat ID: ${revenueCatAppUserId}`);
			return false;
		}

		return await syncUserSubscription(user._id, retries);
	} catch (err) {
		console.error(
			`Sync error for RevenueCat user ${revenueCatAppUserId}:`,
			err.message,
		);
		return false;
	}
};

// Fix: Sync subscription using MongoDB _id, but fetch from RevenueCat using stored revenueCatAppUserId
export const syncUserSubscription = async (userId, retries = 3) => {
	try {
		console.log(`🔄 Syncing subscription for user: ${userId}`);

		// Get user from database
		const user = await User.findById(userId);
		if (!user) {
			console.log(`User not found: ${userId}`);
			return false;
		}

		// CRITICAL: Use the stored RevenueCat App User ID, not the MongoDB _id
		const revenueCatUserId = user.revenueCatAppUserId;

		if (!revenueCatUserId) {
			console.log(
				`⚠️ User ${userId} has no RevenueCat App User ID set. Cannot sync.`,
			);
			// Don't fail - just keep current subscription
			return false;
		}

		// Fetch customer info from RevenueCat using their actual App User ID
		const subscriber = await fetchCustomerInfo(revenueCatUserId);

		// Check entitlements - use YOUR actual entitlement IDs from RevenueCat
		const entitlements = subscriber.entitlements || {};

		// Replace these with your actual entitlement IDs
		const hasBasic = entitlements["Kuditrak Basic"]?.is_active === true;
		const hasPro = entitlements["Kuditrak Pro"]?.is_active === true;

		let plan = "free";
		let status = "active";
		let endDate = null;
		let startDate = null;
		let productId = null;

		if (hasPro) {
			plan = "pro";
			const proEntitlement = entitlements["Kuditrak Pro"];
			endDate = proEntitlement?.expires_date
				? new Date(proEntitlement.expires_date)
				: null;
			startDate = proEntitlement?.purchase_date
				? new Date(proEntitlement.purchase_date)
				: new Date();
			productId = proEntitlement?.product_identifier || "pro";

			// Check if expired
			if (endDate && new Date() > endDate) {
				status = "expired";
			}
		} else if (hasBasic) {
			plan = "basic";
			const basicEntitlement = entitlements["Kuditrak Basic"];
			endDate = basicEntitlement?.expires_date
				? new Date(basicEntitlement.expires_date)
				: null;
			startDate = basicEntitlement?.purchase_date
				? new Date(basicEntitlement.purchase_date)
				: new Date();
			productId = basicEntitlement?.product_identifier || "basic";

			// Check if expired
			if (endDate && new Date() > endDate) {
				status = "expired";
			}
		} else {
			// No active subscription
			plan = "free";
			status = "active";
			endDate = null;
			startDate = null;
			productId = null;
		}

		// Update subscription with correct data
		user.subscription = {
			plan,
			status,
			startDate,
			endDate,
			productId,
			revenueCatId: revenueCatUserId, // Store the actual RevenueCat ID
			lastSyncAt: new Date(),
		};

		await user.save();

		console.log(
			`✅ Subscription synced for user ${userId} (RevenueCat ID: ${revenueCatUserId}): ${plan} (${status})`,
		);
		return true;
	} catch (err) {
		console.error(`Sync error for user ${userId}:`, err.message);
		if (retries > 0) {
			console.log(`Retrying... (${retries} attempts left)`);
			await new Promise((resolve) => setTimeout(resolve, 2000));
			return syncUserSubscription(userId, retries - 1);
		}
		return false;
	}
};

// Sync all users who have revenueCatAppUserId set
export const syncAllActiveSubscriptions = async () => {
	try {
		console.log("🔄 Starting bulk subscription sync...");

		// Wait for MongoDB to be ready
		let attempts = 0;
		while (mongoose.connection.readyState !== 1 && attempts < 10) {
			console.log("⏳ Waiting for MongoDB connection...");
			await new Promise((resolve) => setTimeout(resolve, 1000));
			attempts++;
		}

		if (mongoose.connection.readyState !== 1) {
			console.error("❌ MongoDB not ready after 10 seconds");
			return { synced: 0, failed: 0 };
		}

		// Find all users with revenueCatAppUserId set
		const users = await User.find({
			revenueCatAppUserId: { $exists: true, $ne: null },
			"subscription.status": "active",
		}).limit(50);

		console.log(`Found ${users.length} users with RevenueCat IDs to sync`);

		let synced = 0;
		let failed = 0;

		for (const user of users) {
			const success = await syncUserSubscription(user._id);
			if (success) synced++;
			else failed++;

			// Small delay between each sync to avoid rate limiting
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		console.log(`✅ Bulk sync completed: ${synced} synced, ${failed} failed`);
		return { synced, failed };
	} catch (err) {
		console.error("Bulk sync error:", err);
		return { synced: 0, failed: 0 };
	}
};

// NEW: Link RevenueCat App User ID to existing user
export const linkRevenueCatUser = async (userId, revenueCatAppUserId) => {
	try {
		// Check if this RevenueCat ID is already linked to another user
		const existingUser = await User.findOne({ revenueCatAppUserId });

		if (existingUser && existingUser._id.toString() !== userId.toString()) {
			console.log(
				`⚠️ RevenueCat ID ${revenueCatAppUserId} already linked to user ${existingUser._id}`,
			);

			// Option: Transfer subscription to new user
			// Or reject the link
			return {
				success: false,
				error: "RevenueCat ID already linked to another user",
			};
		}

		// Update user with RevenueCat App User ID
		const user = await User.findByIdAndUpdate(
			userId,
			{ revenueCatAppUserId },
			{ new: true },
		);

		// Immediately sync subscription
		await syncUserSubscription(userId);

		return { success: true, user };
	} catch (err) {
		console.error("Error linking RevenueCat user:", err);
		return { success: false, error: err.message };
	}
};
