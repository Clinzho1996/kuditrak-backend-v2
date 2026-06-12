// controllers/monoController.js
import BankConnection from "../models/BankConnection.js";
import Transaction from "../models/Transaction.js";
import mono from "../services/monoService.js";

export const pullMonoTransactions = async (req, res) => {
	try {
		const { accountId } = req.params;

		const connection = await BankConnection.findOne({
			monoAccountId: accountId,
		});

		if (!connection) {
			return res.status(404).json({ error: "Bank connection not found" });
		}

		const response = await mono.get(`/accounts/${accountId}/transactions`);

		if (!response || !response.data || !response.data.data) {
			return res
				.status(500)
				.json({ error: "Failed to fetch transactions from Mono" });
		}

		const transactions = response.data.data;

		for (const tx of transactions) {
			await Transaction.updateOne(
				{ transactionId: tx._id },
				{
					userId: connection.userId,
					bankConnectionId: connection._id,
					amount: tx.amount,
					description: tx.narration,
					type: tx.type === "debit" ? "expense" : "income",
					date: tx.date,
					source: "bank",
				},
				{ upsert: true },
			);
		}

		res.json({ success: true, count: transactions.length });
	} catch (err) {
		console.error("Error in pullMonoTransactions:", err.message);
		res.status(500).json({ error: err.message });
	}
};
