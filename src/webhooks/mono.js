import BankConnection from "../models/BankConnection.js";
import Transaction from "../models/Transaction.js";

import mono from "../services/monoService.js";

export const pullMonoTransactions = async (req, res) => {
	const { accountId } = req.params;

	const connection = await BankConnection.findOne({
		monoAccountId: accountId,
	});

	const response = await mono.get(`/accounts/${accountId}/transactions`);

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

	res.json({
		success: true,
	});
};
