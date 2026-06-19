// backend/utils/anchorHelper.js
import crypto from "crypto";

/**
 * Format amount to kobo (smallest currency unit)
 * @param {number} amount - Amount in Naira
 * @returns {number} Amount in kobo
 */
export const toKobo = (amount) => {
	return Math.round(amount * 100);
};

/**
 * Format amount from kobo to Naira
 * @param {number} kobo - Amount in kobo
 * @returns {number} Amount in Naira
 */
export const fromKobo = (kobo) => {
	return kobo / 100;
};

/**
 * Format phone number to international format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone number
 */
export const formatPhoneNumber = (phone) => {
	// Remove any non-digit characters
	let cleaned = phone.replace(/\D/g, "");

	// Check if it's a Nigerian number
	if (cleaned.startsWith("0")) {
		cleaned = "234" + cleaned.substring(1);
	} else if (cleaned.startsWith("234")) {
		// Already in international format
	} else if (cleaned.length === 10) {
		cleaned = "234" + cleaned;
	}

	return cleaned;
};

/**
 * Generate a unique reference ID
 * @param {string} prefix - Optional prefix
 * @returns {string} Unique reference
 */
export const generateReference = (prefix = "KUD") => {
	const timestamp = Date.now();
	const random = crypto.randomBytes(4).toString("hex").toUpperCase();
	return `${prefix}_${timestamp}_${random}`;
};

/**
 * Validate BVN
 * @param {string} bvn - BVN to validate
 * @returns {boolean} Is valid
 */
export const isValidBVN = (bvn) => {
	return /^\d{11}$/.test(bvn);
};

/**
 * Validate email
 * @param {string} email - Email to validate
 * @returns {boolean} Is valid
 */
export const isValidEmail = (email) => {
	const emailRegex = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
	return emailRegex.test(email);
};

/**
 * Split full name into first, last, middle
 * @param {string} fullName - Full name
 * @returns {Object} Name parts
 */
export const splitFullName = (fullName) => {
	const parts = fullName.trim().split(/\s+/);
	const firstName = parts[0];
	const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
	const middleName = null;
	const maidenName = null;

	return { firstName, lastName, middleName, maidenName };
};

/**
 * Format address for Anchor API - FIXED VERSION
 * @param {Object} address - Address object from user
 * @returns {Object} Formatted address for Anchor
 */
// backend/utils/anchorHelper.js - Update formatAddress

export const formatAddress = (address) => {
	// If address is already formatted for Anchor, use it directly
	if (address?.addressLine_1) {
		return {
			addressLine_1: address.addressLine_1,
			addressLine_2: address.addressLine_2 || null,
			city: address.city || "Lagos",
			state: address.state || "Lagos",
			postalCode: address.postalCode || "100001",
			country: address.country || "NG",
		};
	}

	// Otherwise, format from user's KYC data
	return {
		addressLine_1: address?.street || "123 Test Street",
		addressLine_2: null,
		city: address?.city || "Lagos",
		state: address?.state || "Lagos",
		postalCode: address?.postalCode || "100001",
		country: address?.country || "NG",
	};
};

/**
 * Format date for Anchor API (YYYY-MM-DD)
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
export const formatDateForAnchor = (date) => {
	const d = new Date(date);
	return d.toISOString().split("T")[0];
};

/**
 * Calculate fee for transaction
 * @param {number} amount - Transaction amount
 * @param {string} type - Transaction type (transfer, card, deposit)
 * @returns {Object} Fee breakdown
 */
export const calculateFee = (amount, type = "transfer") => {
	const fees = {
		transfer: { percentage: 0.005, min: 10, max: 1000 },
		card: { percentage: 0.015, min: 20, max: 2000 },
		deposit: { percentage: 0, min: 0, max: 0 },
	};

	const feeConfig = fees[type] || fees.transfer;
	const calculatedFee = amount * feeConfig.percentage;
	const fee = Math.min(Math.max(calculatedFee, feeConfig.min), feeConfig.max);

	return {
		processingFee: fee,
		totalFee: fee,
		percentage: feeConfig.percentage,
	};
};

/**
 * Mask sensitive data for logging
 * @param {Object} data - Data to mask
 * @returns {Object} Masked data
 */
export const maskSensitiveData = (data) => {
	const masked = { ...data };

	if (masked.bvn) {
		masked.bvn = masked.bvn.slice(0, 4) + "******" + masked.bvn.slice(-1);
	}
	if (masked.pan) {
		masked.pan = "******" + masked.pan.slice(-4);
	}
	if (masked.accountNumber) {
		masked.accountNumber = "******" + masked.accountNumber.slice(-4);
	}
	if (masked.cardNumber) {
		masked.cardNumber = "******" + masked.cardNumber.slice(-4);
	}

	return masked;
};

/**
 * Retry async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise} Result
 */
export const retryWithBackoff = async (
	fn,
	maxRetries = 3,
	baseDelay = 1000,
) => {
	let lastError;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			console.log(`Attempt ${attempt} failed: ${error.message}`);

			if (attempt === maxRetries) break;

			const delay = baseDelay * Math.pow(2, attempt - 1);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
};

/**
 * Validate webhook payload structure
 * @param {Object} payload - Webhook payload
 * @returns {boolean} Is valid
 */
export const isValidWebhookPayload = (payload) => {
	if (!payload || typeof payload !== "object") return false;
	if (!payload.type || typeof payload.type !== "string") return false;
	if (!payload.data || typeof payload.data !== "object") return false;

	return true;
};

/**
 * Get webhook event type category
 * @param {string} eventType - Webhook event type
 * @returns {string} Category
 */
export const getWebhookCategory = (eventType) => {
	if (eventType.startsWith("customer.identification")) return "kyc";
	if (eventType.startsWith("transaction")) return "transaction";
	if (eventType.startsWith("virtual_account")) return "virtual_account";
	if (eventType.startsWith("card")) return "card";
	return "other";
};

export default {
	toKobo,
	fromKobo,
	formatPhoneNumber,
	generateReference,
	isValidBVN,
	isValidEmail,
	splitFullName,
	formatAddress,
	formatDateForAnchor,
	calculateFee,
	maskSensitiveData,
	retryWithBackoff,
	isValidWebhookPayload,
	getWebhookCategory,
};
