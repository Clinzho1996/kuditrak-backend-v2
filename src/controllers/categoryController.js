// backend/controllers/categoryController.js
import Category from "../models/Category.js";

// Default categories to be created for every user
const DEFAULT_CATEGORIES = [
	// Income categories
	{
		name: "Salary",
		type: "income",
		keywords: ["salary", "payroll", "wages", "bonus"],
	},
	{
		name: "Freelance",
		type: "income",
		keywords: ["freelance", "contract", "gig", "consulting"],
	},
	{
		name: "Investment",
		type: "income",
		keywords: ["investment", "dividend", "interest", "stock"],
	},
	{ name: "Gift", type: "income", keywords: ["gift", "present", "birthday"] },
	{
		name: "Refund",
		type: "income",
		keywords: ["refund", "reimbursement", "cashback"],
	},

	// Expense categories
	{
		name: "Food & Drinks",
		type: "expense",
		keywords: ["food", "drinks", "restaurant", "cafe", "lunch", "dinner"],
	},
	{
		name: "Transport",
		type: "expense",
		keywords: ["uber", "bolt", "taxi", "bus", "train", "fuel", "transport"],
	},
	{
		name: "Shopping",
		type: "expense",
		keywords: ["shopping", "mall", "clothes", "amazon", "jumia"],
	},
	{
		name: "Entertainment",
		type: "expense",
		keywords: ["netflix", "spotify", "cinema", "movies", "concert"],
	},
	{
		name: "Bills & Utilities",
		type: "expense",
		keywords: ["electricity", "water", "internet", "bill", "subscription"],
	},
	{
		name: "Groceries",
		type: "expense",
		keywords: ["groceries", "supermarket", "shoprite", "food items"],
	},
	{
		name: "Healthcare",
		type: "expense",
		keywords: ["hospital", "doctor", "medicine", "pharmacy", "health"],
	},
	{
		name: "Education",
		type: "expense",
		keywords: ["school", "tuition", "books", "course", "education"],
	},
	{
		name: "Housing",
		type: "expense",
		keywords: ["rent", "mortgage", "maintenance", "repair"],
	},
	{
		name: "Savings",
		type: "expense",
		keywords: ["savings", "investment", "emergency fund"],
	},
	{
		name: "Transportation",
		type: "expense",
		keywords: ["car", "maintenance", "repair", "insurance"],
	},
	{
		name: "Personal Care",
		type: "expense",
		keywords: ["hair", "spa", "gym", "fitness", "personal care"],
	},
	{
		name: "Travel",
		type: "expense",
		keywords: ["flight", "hotel", "vacation", "travel", "trip"],
	},
	{
		name: "Miscellaneous",
		type: "expense",
		keywords: ["other", "misc", "random"],
	},
];

// Initialize default categories for a user (called during signup)
export const initializeDefaultCategories = async (userId) => {
	try {
		// Check if user already has categories
		const existingCount = await Category.countDocuments({ userId });
		if (existingCount > 0) {
			console.log(`User ${userId} already has ${existingCount} categories`);
			return;
		}

		// Create all default categories for the user
		const categoriesToCreate = DEFAULT_CATEGORIES.map((cat) => ({
			...cat,
			userId,
		}));

		await Category.insertMany(categoriesToCreate);
		console.log(
			`Created ${categoriesToCreate.length} default categories for user ${userId}`,
		);
	} catch (err) {
		console.error("Error initializing default categories:", err);
		throw err;
	}
};

// List all categories for logged-in user
export const listCategories = async (req, res) => {
	try {
		const categories = await Category.find({ userId: req.user._id }).sort({
			type: 1,
			name: 1,
		});
		res.status(200).json({ success: true, categories });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Get categories by type
export const getCategoriesByType = async (req, res) => {
	try {
		const { type } = req.params;
		if (!["income", "expense"].includes(type)) {
			return res.status(400).json({ error: "Invalid category type" });
		}

		const categories = await Category.find({
			userId: req.user._id,
			type,
		}).sort({ name: 1 });

		res.status(200).json({ success: true, categories });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Get a single category by ID
export const getCategoryById = async (req, res) => {
	try {
		const { id } = req.params;
		const category = await Category.findOne({
			_id: id,
			userId: req.user._id,
		});

		if (!category) {
			return res.status(404).json({ error: "Category not found" });
		}

		res.status(200).json({ success: true, category });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Create a new category - DISABLED for users
export const createCategory = async (req, res) => {
	try {
		// Users cannot create custom categories
		return res.status(403).json({
			error:
				"Custom category creation is disabled. Please use default categories.",
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Update a category - DISABLED for users
export const updateCategory = async (req, res) => {
	try {
		// Users cannot update categories
		return res.status(403).json({
			error:
				"Category modification is disabled. Categories are system-managed.",
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Delete a category - DISABLED for users
export const deleteCategory = async (req, res) => {
	try {
		// Users cannot delete categories
		return res.status(403).json({
			error: "Category deletion is disabled. Categories are system-managed.",
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/categoryController.js
export const getCategoryStats = async (req, res) => {
	try {
		const categories = await Category.find({ userId: req.user._id });

		const stats = {
			total: categories.length,
			income: categories.filter((c) => c.type === "income").length,
			expense: categories.filter((c) => c.type === "expense").length,
		};

		res.status(200).json({ success: true, stats });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};
