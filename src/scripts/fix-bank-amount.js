// backend/scripts/fix-bank-amounts.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";

dotenv.config();

const fixBankTransactionAmounts = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("Connected to MongoDB");

		// Find all bank transactions
		const bankTransactions = await Transaction.find({ source: "bank" });
		console.log(`Found ${bankTransactions.length} bank transactions`);

		let fixedCount = 0;
		let errorCount = 0;

		for (const transaction of bankTransactions) {
			try {
				// Check if amount seems to be in kobo (very large number)
				// Most Naira amounts are between 0 and 10,000,000
				// Kobo amounts would be 100x larger
				if (transaction.amount > 100000) {
					const oldAmount = transaction.amount;
					const newAmount = transaction.amount / 100;

					// Also fix balance if it exists
					let oldBalance = transaction.balance;
					let newBalance = null;
					if (transaction.balance) {
						oldBalance = transaction.balance;
						newBalance = transaction.balance / 100;
					}

					await Transaction.updateOne(
						{ _id: transaction._id },
						{
							$set: {
								amount: newAmount,
								balance: newBalance,
							},
						},
					);

					fixedCount++;
					console.log(
						`Fixed transaction ${transaction.transactionId}: ${oldAmount} -> ${newAmount}`,
					);
					if (newBalance) {
						console.log(`  Balance: ${oldBalance} -> ${newBalance}`);
					}
				}
			} catch (err) {
				console.error(
					`Error fixing transaction ${transaction._id}:`,
					err.message,
				);
				errorCount++;
			}
		}

		console.log(`\n✅ Fixed ${fixedCount} transactions`);
		console.log(`❌ Errors: ${errorCount}`);
		console.log(`📊 Total processed: ${bankTransactions.length}`);

		await mongoose.disconnect();
		console.log("Disconnected from MongoDB");
	} catch (err) {
		console.error("Migration error:", err);
		process.exit(1);
	}
};

fixBankTransactionAmounts();
