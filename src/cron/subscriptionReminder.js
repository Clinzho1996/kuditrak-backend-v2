// backend/cron/subscriptionReminder.js
import cron from "node-cron";
import User from "../models/User.js";
import { sendSubscriptionNotification } from "../services/notificationService.js";

// Run daily at 9 AM
cron.schedule("0 9 * * *", async () => {
	console.log("Checking for expiring subscriptions...");

	const users = await User.find({
		"subscription.status": "active",
		"subscription.endDate": { $exists: true },
	});

	for (const user of users) {
		const daysUntilExpiry = Math.ceil(
			(new Date(user.subscription.endDate) - new Date()) /
				(1000 * 60 * 60 * 24),
		);

		// Send notification 7 days before expiry
		if (daysUntilExpiry === 7) {
			await sendSubscriptionNotification(
				user._id,
				user.subscription.plan,
				daysUntilExpiry,
				"expiring",
			);
		}
	}
});
