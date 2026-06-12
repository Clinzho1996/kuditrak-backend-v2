// backend/scripts/cleanPushTokens.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

const cleanPushTokens = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connected to MongoDB");

		const users = await User.find({ pushTokens: { $exists: true, $ne: [] } });

		let cleaned = 0;

		for (const user of users) {
			let changed = false;

			// Filter out invalid tokens
			const validTokens = user.pushTokens.filter((t) => {
				// Check if token is valid
				if (!t.token || typeof t.token !== "string") {
					changed = true;
					return false;
				}
				// Fix deviceId if it's an object
				if (t.deviceId && typeof t.deviceId === "object") {
					t.deviceId =
						t.deviceId.data || t.deviceId.token || JSON.stringify(t.deviceId);
					changed = true;
				}
				return true;
			});

			if (changed) {
				user.pushTokens = validTokens;
				await user.save();
				cleaned++;
				console.log(
					`Cleaned user ${user._id}: ${validTokens.length} valid tokens`,
				);
			}
		}

		console.log(`✅ Cleaned ${cleaned} users`);
		process.exit(0);
	} catch (err) {
		console.error("Error:", err);
		process.exit(1);
	}
};

cleanPushTokens();
