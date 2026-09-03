export function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function applyDiscount(subtotal, percent) {
  if (percent < 0 || percent > 100) {
    throw new RangeError('discount percent must be between 0 and 100');
  }
  return subtotal - (subtotal * percent) / 100;
}

export function calculateTax(amount, rate) {
  return Math.round(amount * rate * 100) / 100;
}

export function formatTotal(items, options = {}) {
  const { discountPercent = 0, taxRate = 0 } = options;
  const subtotal = calculateSubtotal(items);
  const discounted = applyDiscount(subtotal, discountPercent);
  const tax = calculateTax(discounted, taxRate);
  return Math.round((discounted + tax) * 100) / 100;
}

export function mostExpensiveItem(items) {
  if (items.length === 0) return null;
  return items.reduce((max, item) => (item.price > max.price ? item : max));
}
