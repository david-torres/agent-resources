/**
 * Parses and validates image crop data from form submissions.
 * 
 * Expected crop data structure:
 * {
 *   x: number,           // normalized position (0-1)
 *   y: number,           // normalized position (0-1)
 *   width: number,       // normalized width (0-1)
 *   height: number,      // normalized height (0-1)
 *   naturalWidth: number,  // optional: original image width
 *   naturalHeight: number  // optional: original image height
 * }
 * 
 * @param {string|object|null|undefined} value - Crop data as JSON string or object
 * @returns {object|undefined} - Validated crop object or undefined if invalid
 */
function parseImageCrop(value) {
  // Handle empty/null/undefined values
  if (!value) {
    return undefined;
  }

  // If it's already an object, use it directly
  let crop;
  if (typeof value === 'object') {
    crop = value;
  } else if (typeof value === 'string') {
    // Try to parse JSON string
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return undefined;
    }
    try {
      crop = JSON.parse(trimmed);
    } catch (error) {
      // Invalid JSON, return undefined
      return undefined;
    }
  } else {
    // Invalid type
    return undefined;
  }

  // Validate it's an object
  if (!crop || typeof crop !== 'object' || Array.isArray(crop)) {
    return undefined;
  }

  // Validate required fields: x, y, width, height must be numbers
  const { x, y, width, height, naturalWidth, naturalHeight } = crop;

  // Check required fields exist and are numbers
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return undefined;
  }

  // Validate normalized values are in valid range (0-1)
  if (
    x < 0 || x > 1 ||
    y < 0 || y > 1 ||
    width <= 0 || width > 1 ||
    height <= 0 || height > 1
  ) {
    return undefined;
  }

  // Validate optional natural dimensions if present
  if (naturalWidth !== undefined) {
    if (typeof naturalWidth !== 'number' || naturalWidth <= 0 || !Number.isFinite(naturalWidth)) {
      return undefined;
    }
  }

  if (naturalHeight !== undefined) {
    if (typeof naturalHeight !== 'number' || naturalHeight <= 0 || !Number.isFinite(naturalHeight)) {
      return undefined;
    }
  }

  // Return validated crop object
  const validated = {
    x,
    y,
    width,
    height
  };

  // Include natural dimensions if present
  if (naturalWidth !== undefined) {
    validated.naturalWidth = naturalWidth;
  }
  if (naturalHeight !== undefined) {
    validated.naturalHeight = naturalHeight;
  }

  return validated;
}

// parseImageCrop answers `undefined` for two different things: "the user cleared
// the crop" -- '' or, because the hidden field renders
// `{{{JSONstringify class.image_crop}}}`, the literal string `null` -- and "this
// value is not a crop at all". Only the first is an instruction to store NULL.
//
// Writing NULL for the second would let a malformed field wipe a stored crop,
// and leaving the raw string in req.body -- what happened before -- writes it
// into the jsonb column: that is how 17 of the 50 live rows came to hold a jsonb
// string (`""` or a double-encoded object) instead of an object or NULL. Neither
// is acceptable, so an unreadable value drops the key and the stored value is
// left exactly as it is, the same way dropAdminOnlyFields leaves a column alone
// by removing it from the payload.
const CLEARED_CROP_VALUES = ['', 'null', 'undefined'];

const applyImageCrop = (body) => {
    const image_crop = parseImageCrop(body.image_crop);
    if (image_crop !== undefined) {
        body.image_crop = image_crop;
        return;
    }
    const posted = typeof body.image_crop === 'string' ? body.image_crop.trim() : body.image_crop;
    if (CLEARED_CROP_VALUES.includes(posted)) {
        body.image_crop = null;
        return;
    }
    delete body.image_crop;
};

module.exports = {
  parseImageCrop,
  applyImageCrop
};
