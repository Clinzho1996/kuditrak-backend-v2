// backend/jobs/syncSubscriptions.js
import cron from "node-cron";
import { syncAllActiveSubscriptions } from "../services/subscriptionSyncService.js";

// Run every hour
cron.schedule("0 * * * *", async () => {
	console.log("⏰ Running scheduled subscription sync...");
	await syncAllActiveSubscriptions();
});

// Run on server startup
export const initSubscriptionSync = async () => {
	console.log("🚀 Initializing subscription sync service...");
	await syncAllActiveSubscriptions();
};
