// scripts/migrate-goal-fields.js

import dotenv from "dotenv";
import mongoose from "mongoose";

// Load environment variables
dotenv.config({ path: ".env.local" });

// ✅ Use your production MongoDB URI (from your .env.local file)
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// ✅ If you're using MongoDB Atlas, it should look like:
// mongodb+srv://username:password@cluster.mongodb.net/database

console.log(`📊 Connecting to MongoDB...`);
console.log(
	`   URI: ${MONGODB_URI ? MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, "//***:***@") : "NOT SET"}`,
);

mongoose.connect(MONGODB_URI);

const db = mongoose.connection;

db.on("error", console.error.bind(console, "❌ MongoDB connection error:"));
db.once("open", async function () {
	console.log("✅ Connected to MongoDB");

	try {
		// Get the collection
		const collection = db.collection("usergoals");

		// 1. Add missing fields to all documents
		console.log("📝 Adding missing fields to goals...");

		const result = await collection.updateMany(
			{},
			{
				$set: {
					goalDepositAccountId: null,
					goalAccountNumber: null,
					goalBankName: null,
					goalBankCode: null,
					goalAccountStatus: "pending",
					goalAccountBalance: 0,
					updatedAt: new Date(),
				},
			},
		);

		console.log(`✅ Updated ${result.modifiedCount} document(s)`);
		console.log(`📊 Matched ${result.matchedCount} document(s)`);

		// 2. Verify the update
		console.log("\n📊 Verifying updates...");

		const goals = await collection.find({}).toArray();
		console.log(`Total goals: ${goals.length}`);

		goals.forEach((goal) => {
			console.log(`\n📌 Goal: ${goal.name}`);
			console.log(`   _id: ${goal._id}`);
			console.log(
				`   goalDepositAccountId: ${goal.goalDepositAccountId || "NULL"}`,
			);
			console.log(`   goalAccountNumber: ${goal.goalAccountNumber || "NULL"}`);
			console.log(`   goalBankName: ${goal.goalBankName || "NULL"}`);
			console.log(`   goalBankCode: ${goal.goalBankCode || "NULL"}`);
			console.log(`   goalAccountStatus: ${goal.goalAccountStatus || "NULL"}`);
			console.log(`   goalAccountBalance: ${goal.goalAccountBalance || 0}`);
		});

		// 3. Create indexes for better performance
		console.log("\n📊 Creating indexes...");
		await collection.createIndex({ goalDepositAccountId: 1 });
		await collection.createIndex({ userId: 1, goalDepositAccountId: 1 });
		console.log("✅ Indexes created");

		console.log("\n✅ Migration completed successfully!");
		process.exit(0);
	} catch (error) {
		console.error("❌ Migration failed:", error);
		process.exit(1);
	}
});
