// scripts/addWalletAllocatedField.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import AnchorWallet from "../models/AnchorWallet.js";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGO_URI || process.env.DATABASE_URL;

async function migrate() {
	try {
		await mongoose.connect(MONGODB_URI);
		console.log("✅ Connected to MongoDB");

		// Add allocated and available fields
		const result = await AnchorWallet.updateMany(
			{ allocated: { $exists: false } },
			{ $set: { allocated: 0, available: 0 } },
		);

		console.log(`✅ Updated ${result.modifiedCount} wallets`);

		await mongoose.disconnect();
		console.log("✅ Done");
	} catch (error) {
		console.error("❌ Migration failed:", error);
		process.exit(1);
	}
}

migrate();
