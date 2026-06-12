// scripts/fix-transactions.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";

dotenv.config();

const MONGODB_URI =
	process.env.MONGO_URI || "mongodb://localhost:27017/kuditrak";

const fixTransactions = async () => {
	try {
		await mongoose.connect(MONGODB_URI);
		console.log("✅ Connected to MongoDB");
		console.log("========================================");
		console.log("FIXING BANK TRANSACTIONS");
		console.log("========================================\n");

		// Find all bank transactions
		const bankTransactions = await Transaction.find({ source: "bank" });
		console.log(`📊 Found ${bankTransactions.length} bank transactions\n`);

		let fixedCount = 0;
		let typeFixedCount = 0;
		let amountFixedCount = 0;

		for (const transaction of bankTransactions) {
			let needsUpdate = false;
			let updates = {};
			let messages = [];

			// 1. Fix amount - if amount > 10000, it's likely in kobo
			if (transaction.amount > 10000) {
				const oldAmount = transaction.amount;
				const newAmount = transaction.amount / 100;
				updates.amount = newAmount;
				needsUpdate = true;
				amountFixedCount++;
				messages.push(`Amount: ${oldAmount} → ${newAmount} NGN`);

				// Fix balance if exists
				if (transaction.balance && transaction.balance > 10000) {
					const oldBalance = transaction.balance;
					const newBalance = transaction.balance / 100;
					updates.balance = newBalance;
					messages.push(`Balance: ${oldBalance} → ${newBalance} NGN`);
				}
			}

			// 2. Fix type based on metadata.originalType
			if (transaction.metadata && transaction.metadata.originalType) {
				const originalType = transaction.metadata.originalType;
				let correctType = transaction.type;

				if (originalType === "credit" || originalType === "income") {
					correctType = "income";
				} else if (originalType === "debit") {
					correctType = "expense";
				}

				if (correctType !== transaction.type) {
					updates.type = correctType;
					needsUpdate = true;
					typeFixedCount++;
					messages.push(
						`Type: ${transaction.type} → ${correctType} (${originalType})`,
					);
				}
			}

			// Apply updates
			if (needsUpdate) {
				await Transaction.updateOne(
					{ _id: transaction._id },
					{ $set: updates },
				);
				fixedCount++;
				console.log(`✅ Fixed ${transaction.transactionId}:`);
				messages.forEach((msg) => console.log(`   ${msg}`));
				console.log("");
			}
		}

		console.log("========================================");
		console.log("📊 SUMMARY");
		console.log("========================================");
		console.log(`   Total transactions processed: ${bankTransactions.length}`);
		console.log(`   Amount fixes: ${amountFixedCount}`);
		console.log(`   Type fixes: ${typeFixedCount}`);
		console.log(`   Total fixed: ${fixedCount}`);
		console.log("========================================");

		// Verify fixes
		console.log("\n📋 VERIFICATION:");
		const remainingKobo = await Transaction.countDocuments({
			source: "bank",
			amount: { $gt: 10000 },
		});
		console.log(`   Remaining amounts in kobo: ${remainingKobo} (should be 0)`);

		const sampleTransactions = await Transaction.find({ source: "bank" }).limit(
			3,
		);
		console.log("\n   Sample transactions:");
		for (const tx of sampleTransactions) {
			console.log(
				`   - ${tx.transactionId}: ₦${tx.amount} - ${tx.type} - ${tx.description}`,
			);
		}

		await mongoose.disconnect();
		console.log("\n✅ Disconnected from MongoDB");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
};

fixTransactions();
