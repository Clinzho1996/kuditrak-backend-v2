// services/categorizationService.js
import Category from "../models/Category.js";
import Transaction from "../models/Transaction.js";

/**
 * Categorize a single transaction without AI
 * Uses keyword matching and defaults to "Uncategorized"
 */
export const categorizeTransaction = async (userId, tx) => {
	try {
		const categories = await Category.find({ userId });

		for (const cat of categories) {
			for (const keyword of cat.keywords) {
				if (tx.description.toLowerCase().includes(keyword.toLowerCase())) {
					return {
						categoryId: cat._id,
						categoryName: cat.name,
						type: cat.type,
					};
				}
			}
		}

		// Default category if no match
		return { categoryId: null, categoryName: "Uncategorized", type: tx.type };
	} catch (err) {
		console.error(
			`Error categorizing transaction "${tx.description}": ${err.message}`,
		);
		return { categoryId: null, categoryName: "Uncategorized", type: tx.type };
	}
};

/**
 * Save transactions to DB with categorization
 */
export const saveTransactionsToDB = async (
	userId,
	bankConnectionId,
	transactions,
) => {
	for (const tx of transactions) {
		try {
			if (tx.id) {
				const exists = await Transaction.findOne({ transactionId: tx.id });
				if (exists) continue;
			}

			const category = await categorizeTransaction(userId, tx);

			const newTx = new Transaction({
				userId,
				bankConnectionId: bankConnectionId || null,
				transactionId: tx.id || null,
				amount: tx.amount,
				type: category.type,
				description: tx.description,
				categoryId: category.categoryId,
				categoryName: category.categoryName,
				source: bankConnectionId ? "bank" : "manual",
				date: tx.date || new Date(),
			});

			await newTx.save();
		} catch (err) {
			console.error(
				`Failed to save transaction "${tx.description}": ${err.message}`,
			);
		}
	}
};
