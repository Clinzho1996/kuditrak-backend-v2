// backend/controllers/subscriptionController.js
import User from "../models/User.js";
import {
	linkRevenueCatUser,
	syncUserSubscription,
} from "../services/subscriptionSyncService.js";

// ===============================
// CLEAN DATABASE - Remove all free subscriptions
// ===============================
export const cleanDatabase = async (req, res) => {
	try {
		// Remove subscription from ALL free users
		const result = await User.updateMany(
			{ "subscription.plan": "free" },
			{ $unset: { subscription: "" } },
		);

		// Also remove any users with subscription but no plan
		const result2 = await User.updateMany(
			{ "subscription.plan": { $exists: false } },
			{ $unset: { subscription: "" } },
		);

		// For paid users, ensure they have endDate
		const paidUsers = await User.find({
			"subscription.plan": { $in: ["basic", "pro"] },
			"subscription.endDate": null,
		});

		for (const user of paidUsers) {
			user.subscription.endDate = new Date(
				Date.now() + 30 * 24 * 60 * 60 * 1000,
			);
			await user.save();
		}

		// Count results using countDocuments()
		const freeUsers = await User.countDocuments({
			subscription: { $exists: false },
		});
		const basicUsers = await User.countDocuments({
			"subscription.plan": "basic",
		});
		const proUsers = await User.countDocuments({ "subscription.plan": "pro" });

		res.json({
			success: true,
			message: "Database cleaned",
			removedFreeSubscriptions: result.modifiedCount,
			stats: {
				free: freeUsers,
				basic: basicUsers,
				pro: proUsers,
			},
		});
	} catch (err) {
		console.error("Clean database error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// GET SUBSCRIPTION
// ===============================
export const getSubscription = async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("subscription");

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// No subscription = free user
		if (!user.subscription || !user.subscription.plan) {
			return res.status(200).json({
				success: true,
				data: {
					plan: "free",
					status: "active",
				},
			});
		}

		// Check if subscription expired
		const now = new Date();
		if (
			user.subscription.status === "active" &&
			user.subscription.endDate &&
			new Date(user.subscription.endDate) < now
		) {
			user.subscription.status = "expired";
			await user.save();
		}

		return res.status(200).json({
			success: true,
			data: user.subscription,
		});
	} catch (err) {
		console.error("Get Subscription Error:", err.message);
		return res.status(500).json({ error: err.message });
	}
};

// ===============================
// SYNC SUBSCRIPTION
// ===============================
// backend/controllers/subscriptionController.js
export const syncSubscription = async (req, res) => {
	try {
		const {
			plan,
			productId,
			revenueCatId,
			startDate,
			endDate,
			originalTransactionId, // CRITICAL: This must come from RevenueCat
			appUserId, // RevenueCat's app_user_id
		} = req.body;

		if (!plan) {
			return res.status(400).json({
				success: false,
				error: "Plan is required",
			});
		}

		// VALIDATION: If it's a paid plan, we MUST have real identifiers
		if (plan !== "free") {
			if (!originalTransactionId && !revenueCatId) {
				return res.status(400).json({
					success: false,
					error:
						"Paid subscriptions require originalTransactionId or revenueCatId from RevenueCat",
				});
			}
		}

		const user = await User.findById(req.user._id);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Free plan - remove subscription
		if (plan === "free") {
			user.subscription = undefined;
			await user.save();
			return res.status(200).json({
				success: true,
				message: "User is on free plan",
				data: { plan: "free", status: "active" },
			});
		}

		// For paid plans: Check if this transaction already belongs to someone else
		let existingSubscription = null;

		if (originalTransactionId) {
			// Search by originalTransactionId (most reliable)
			existingSubscription = await User.findOne({
				"subscription.originalTransactionId": originalTransactionId,
				_id: { $ne: user._id },
			});
		} else if (revenueCatId && !revenueCatId.startsWith(user._id.toString())) {
			// Only search by revenueCatId if it's not a fake ID
			existingSubscription = await User.findOne({
				"subscription.revenueCatId": revenueCatId,
				_id: { $ne: user._id },
			});
		}

		if (existingSubscription) {
			console.error(
				`Subscription already belongs to user: ${existingSubscription._id}`,
			);
			return res.status(403).json({
				success: false,
				error: "This subscription belongs to another account",
				code: "SUBSCRIPTION_OWNERSHIP_MISMATCH",
			});
		}

		// Update or create subscription with REAL identifiers
		user.subscription = {
			plan,
			status: "active",
			startDate: startDate ? new Date(startDate) : new Date(),
			endDate: endDate
				? new Date(endDate)
				: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			productId: productId || null,
			// NEVER default to user._id - only use real values
			revenueCatId: revenueCatId || null,
			originalTransactionId: originalTransactionId || null,
			appUserId: appUserId || null, // Store RevenueCat's app_user_id
		};

		await user.save();

		return res.status(200).json({
			success: true,
			message: "Subscription synced",
			data: user.subscription,
		});
	} catch (err) {
		console.error("Sync Subscription Error:", err.message);
		return res.status(500).json({ error: err.message });
	}
};

// Link RevenueCat App User ID to current user
export const linkRevenueCatId = async (req, res) => {
	try {
		const { revenueCatAppUserId } = req.body;

		if (!revenueCatAppUserId) {
			return res.status(400).json({ error: "revenueCatAppUserId is required" });
		}

		const { success, error, user } = await linkRevenueCatUser(
			req.user._id,
			revenueCatAppUserId,
		);

		if (!success) {
			return res.status(400).json({ error });
		}

		res.json({
			success: true,
			message: "RevenueCat ID linked successfully",
			subscription: user.subscription,
		});
	} catch (err) {
		console.error("Link RevenueCat ID error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Force sync subscription for current user
export const forceSyncSubscription = async (req, res) => {
	try {
		const success = await syncUserSubscription(req.user._id);

		if (!success) {
			return res.status(400).json({
				error:
					"Failed to sync subscription. User may not have RevenueCat ID linked.",
			});
		}

		const user = await User.findById(req.user._id);

		res.json({
			success: true,
			message: "Subscription synced successfully",
			subscription: user.subscription,
		});
	} catch (err) {
		console.error("Force sync error:", err);
		res.status(500).json({ error: err.message });
	}
};
