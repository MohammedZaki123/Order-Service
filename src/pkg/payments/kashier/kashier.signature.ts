
import {timingSafeEqual, createHmac} from "node:crypto";

function safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    return timingSafeEqual(bufA, bufB);
}

export function verifyKashierWebhookSignature(
    data: Record<string, unknown>,
    signature: string,
    signatureKeys: string[],
    apiKey: string
): boolean {
    // Prefer the provided signatureKeys input parameter. If it's not provided or invalid,
    // fall back to payload.data.signatureKeys for backward compatibility.
        if (!signature || typeof signature !== "string") return false;


    // let keys: string[] | undefined = Array.isArray(signatureKeys) && signatureKeys.length > 0 ? signatureKeys : undefined;

    // if (!keys) {
    //     if (!Array.isArray(data.signatureKeys) || data.signatureKeys.length === 0) {
    //         return false;
    //     }
    //     keys = data.signatureKeys as string[];
    // }

    const sortedKeys = [...signatureKeys].sort();



      const signaturePayload =  sortedKeys.map((k) => {
            const v = data[k];
            const stringified = v === undefined || v === null ? "" : String(v);
            return `${k}=${encodeURIComponent(stringified)}`;
        })
        .join("&");



    // const signaturePayload = sortedKeys
    //     .map(key => {
    //         const val = data[key] !== undefined && data[key] !== null ? String(data[key]) : "";
    //         // Percent-encode RFC 3986 style
    //         const encodedVal = encodeURIComponent(val)
    //             .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    //             .replace(/%20/g, "+"); // Webhooks sometimes use + or %20. Let's make it robust!
    //         return `${key}=${encodedVal}`;
    //     })
    //     .join("&");

    const computedSignature =
        createHmac("sha256", apiKey)
        .update(signaturePayload, "utf8")
        .digest("hex");

    // Try both percent-encoded and plus-encoded spaces just to be extremely resilient
    return safeCompare(computedSignature, signature);


    // // Try percent-encoded only
    // const signaturePayloadPercentOnly = sortedKeys
    //     .map(key => {
    //         const val = data[key] !== undefined && data[key] !== null ? String(data[key]) : "";
    //         const encodedVal = encodeURIComponent(val)
    //             .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    //         return `${key}=${encodedVal}`;
    //     })
    //     .join("&");
    //
    // const computedSignaturePercentOnly = crypto
    //     .createHmac("sha256", apiKey)
    //     .update(signaturePayloadPercentOnly)
    //     .digest("hex");
    //
    // if (safeCompare(computedSignaturePercentOnly, signature)) {
    //     return true;
    // }
    //
    // // Try completely unencoded (standard C# style)
    // const signaturePayloadUnencoded = sortedKeys
    //     .map(key => {
    //         const val = data[key] !== undefined && data[key] !== null ? String(data[key]) : "";
    //         return `${key}=${val}`;
    //     })
    //     .join("&");
    //
    // const computedSignatureUnencoded = crypto
    //     .createHmac("sha256", apiKey)
    //     .update(signaturePayloadUnencoded)
    //     .digest("hex");
    //
    // return safeCompare(computedSignatureUnencoded, signature);
}
