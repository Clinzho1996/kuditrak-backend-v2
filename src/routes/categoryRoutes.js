import express from "express";
import {
	createCategory,
	deleteCategory,
	getCategoriesByType,
	getCategoryById,
	getCategoryStats,
	listCategories,
	updateCategory,
} from "../controllers/categoryController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// GET routes
router.get("/stats", protect, getCategoryStats);
router.get("/type/:type", protect, getCategoriesByType);
router.get("/:id", protect, getCategoryById);

router.get("/", protect, listCategories);
router.post("/", protect, createCategory);
router.put("/:id", protect, updateCategory);
router.delete("/:id", protect, deleteCategory);

export default router;
