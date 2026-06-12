import axios from "axios";
import Transaction from "../models/Transaction.js";
import { categorizeTransaction } from "./categorizationService.js";

// Pull transactions for a bank connection
export const pullTransactions = async (connection) => {
	if (connection.provider === "mono") {
		const transactions = await fetchMonoTransactions(connection);
		await saveTransactionsToDB(connection.userId, connection._id, transactions);
	}

	// Flutterwave could be handled here (for top-ups/transfers only)
};

// Fetch transactions from Mono API
const fetchMonoTransactions = async (connection) => {
	try {
		const response = await axios.get(
			`https://api.withmono.com/accounts/${connection.accountNumber}/transactions`,
			{
				headers: {
					Authorization: `Bearer ${process.env.MONO_SECRET}`,
					"Content-Type": "application/json",
				},
			},
		);

		// Return transactions array from Mono API response
		return response.data.data || [];
	} catch (err) {
		console.error(`Failed to fetch Mono transactions: ${err.message}`);
		return [];
	}
};

// Save transactions to MongoDB
export const saveTransactionsToDB = async (
	userId,
	bankConnectionId,
	transactions,
) => {
	for (const tx of transactions) {
		try {
			const exists = await Transaction.findOne({ transactionId: tx.id });
			if (exists) continue;

			const category = await categorizeTransaction(userId, tx);

			const newTx = new Transaction({
				userId,
				bankConnectionId,
				transactionId: tx.id,
				amount: tx.amount,
				type: category.type,
				description: tx.description,
				categoryId: category.categoryId,
				categoryName: category.categoryName,
				source: "bank",
				date: tx.date,
			});

			await newTx.save();
		} catch (err) {
			console.error(`Failed to save transaction ${tx.id}: ${err.message}`);
		}
	}
};
