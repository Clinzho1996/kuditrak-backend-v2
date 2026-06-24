// backend/services/dojahService.js

import axios from "axios";

const DOJAH_BASE_URL = "https://api.dojah.io/api/v1";
const DOJAH_APP_ID = process.env.DOJAH_APP_ID;
const DOJAH_API_KEY = process.env.DOJAH_API_KEY;
const DOJAH_SANDBOX = process.env.DOJAH_SANDBOX === "true";

// Create axios instance
const dojahApi = axios.create({
	baseURL: DOJAH_BASE_URL,
	headers: {
		AppId: DOJAH_APP_ID,
		ApiKey: DOJAH_API_KEY,
		"Content-Type": "application/json",
	},
	timeout: 30000,
});

const handleDojahError = (error) => {
	if (error.response) {
		console.error("Dojah API Error:", {
			status: error.response.status,
			data: error.response.data,
		});
		return {
			success: false,
			error: error.response.data?.message || "Dojah API error",
			statusCode: error.response.status,
			details: error.response.data,
		};
	}
	return {
		success: false,
		error: error.message,
		statusCode: 500,
	};
};

/**
 * Verify NIN (National Identification Number)
 * @param {string} nin - 11-digit NIN
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @param {string} dob - Date of birth (YYYY-MM-DD)
 */
export const verifyNIN = async (nin, firstName, lastName, dob) => {
	try {
		console.log(`🔍 Verifying NIN: ${nin}`);

		const payload = {
			nin: nin,
			first_name: firstName,
			last_name: lastName,
			dob: dob,
		};

		const response = await dojahApi.post("/nin/verify", payload);

		if (response.data?.status === 200) {
			const data = response.data.data || response.data;
			return {
				success: true,
				verified: data.verified || data.status === "success",
				data: data,
				fullName: data.full_name || `${data.first_name} ${data.last_name}`,
				dateOfBirth: data.dob || data.date_of_birth,
				gender: data.gender,
				photo: data.photo,
			};
		}

		return {
			success: false,
			error: response.data?.message || "NIN verification failed",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

/**
 * Verify BVN (Bank Verification Number)
 * @param {string} bvn - 11-digit BVN
 * @param {string} dob - Date of birth (YYYY-MM-DD)
 * @param {string} phone - Phone number
 */
export const verifyBVN = async (bvn, dob, phone) => {
	try {
		console.log(`🔍 Verifying BVN: ${bvn}`);

		const payload = {
			bvn: bvn,
			dob: dob,
			phone: phone,
		};

		const response = await dojahApi.post("/bvn/verify", payload);

		if (response.data?.status === 200) {
			const data = response.data.data || response.data;
			return {
				success: true,
				verified: data.verified || data.status === "success",
				data: data,
				fullName: data.full_name,
				dateOfBirth: data.dob,
				gender: data.gender,
				image: data.image || data.photo,
			};
		}

		return {
			success: false,
			error: response.data?.message || "BVN verification failed",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

/**
 * Verify International Passport
 * @param {string} passportNumber - Passport number
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @param {string} dob - Date of birth (YYYY-MM-DD)
 * @param {string} expiryDate - Expiry date (YYYY-MM-DD)
 */
export const verifyPassport = async (
	passportNumber,
	firstName,
	lastName,
	dob,
	expiryDate,
) => {
	try {
		console.log(`🔍 Verifying Passport: ${passportNumber}`);

		const payload = {
			passport_number: passportNumber,
			first_name: firstName,
			last_name: lastName,
			dob: dob,
			expiry_date: expiryDate,
		};

		const response = await dojahApi.post("/passport/verify", payload);

		if (response.data?.status === 200) {
			const data = response.data.data || response.data;
			return {
				success: true,
				verified: data.verified || data.status === "success",
				data: data,
				fullName: data.full_name,
				dateOfBirth: data.dob,
				gender: data.gender,
				passportNumber: data.passport_number,
				expiryDate: data.expiry_date,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Passport verification failed",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

/**
 * Verify Driver's License
 * @param {string} licenseNumber - Driver's license number
 * @param {string} dob - Date of birth (YYYY-MM-DD)
 */
export const verifyDriversLicense = async (licenseNumber, dob) => {
	try {
		console.log(`🔍 Verifying Driver's License: ${licenseNumber}`);

		const payload = {
			license_number: licenseNumber,
			dob: dob,
		};

		const response = await dojahApi.post("/drivers-license/verify", payload);

		if (response.data?.status === 200) {
			const data = response.data.data || response.data;
			return {
				success: true,
				verified: data.verified || data.status === "success",
				data: data,
				fullName: data.full_name,
				dateOfBirth: data.dob,
				licenseNumber: data.license_number,
				expiryDate: data.expiry_date,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Driver's license verification failed",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

/**
 * Verify Proof of Address using utility bill
 * @param {string} imageUrl - URL of the utility bill image
 * @param {string} address - Address to verify
 * @param {string} fullName - User's full name
 */
export const verifyAddress = async (imageUrl, address, fullName) => {
	try {
		console.log(`🔍 Verifying Proof of Address`);

		const payload = {
			image_url: imageUrl,
			address: address,
			full_name: fullName,
		};

		const response = await dojahApi.post("/address/verify", payload);

		if (response.data?.status === 200) {
			const data = response.data.data || response.data;
			return {
				success: true,
				verified: data.verified || data.status === "success",
				data: data,
				address: data.extracted_address || data.address,
				confidence: data.confidence_score || 0,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Address verification failed",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

/**
 * Liveness Check - Face Match
 * @param {string} selfieImage - Base64 or URL of selfie
 * @param {string} idImage - Base64 or URL of ID image
 */
export const livenessCheck = async (selfieImage, idImage) => {
	try {
		console.log(`🔍 Performing Liveness Check`);

		const payload = {
			selfie_image: selfieImage,
			id_image: idImage,
		};

		const response = await dojahApi.post("/liveness/verify", payload);

		if (response.data?.status === 200) {
			const data = response.data.data || response.data;
			return {
				success: true,
				passed: data.passed || data.status === "success",
				data: data,
				confidence: data.confidence_score || 0,
				isReal: data.is_real_person || false,
				antiSpoofing: data.anti_spoofing || {},
			};
		}

		return {
			success: false,
			error: response.data?.message || "Liveness check failed",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

/**
 * Get all KYC services status
 * @param {string} nin - User's NIN
 * @param {string} bvn - User's BVN
 */
export const getKYCStatus = async (nin, bvn) => {
	try {
		console.log(`🔍 Getting KYC Status`);

		const payload = {
			nin: nin,
			bvn: bvn,
		};

		const response = await dojahApi.post("/kyc/status", payload);

		if (response.data?.status === 200) {
			return {
				success: true,
				data: response.data.data || response.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to get KYC status",
		};
	} catch (error) {
		return handleDojahError(error);
	}
};

export default {
	verifyNIN,
	verifyBVN,
	verifyPassport,
	verifyDriversLicense,
	verifyAddress,
	livenessCheck,
	getKYCStatus,
};
