import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSubtotal,
  applyDiscount,
  calculateTax,
  formatTotal,
  mostExpensiveItem,
} from '../src/cart.js';

test('calculateSubtotal sums price times quantity', () => {
  const items = [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 },
  ];
  assert.equal(calculateSubtotal(items), 35);
});

test('calculateSubtotal returns 0 for an empty cart', () => {
  assert.equal(calculateSubtotal([]), 0);
});

test('applyDiscount reduces the subtotal by percent', () => {
  assert.equal(applyDiscount(100, 10), 90);
});

test('applyDiscount rejects an out-of-range percent', () => {
  assert.throws(() => applyDiscount(100, 150), RangeError);
  assert.throws(() => applyDiscount(100, -1), RangeError);
});

test('calculateTax rounds to two decimals', () => {
  assert.equal(calculateTax(19.999, 0.1), 2);
});

test('formatTotal combines discount and tax', () => {
  const items = [{ price: 50, quantity: 2 }];
  const total = formatTotal(items, { discountPercent: 10, taxRate: 0.08 });
  // subtotal 100, discounted 90, tax 7.2, total 97.2
  assert.equal(total, 97.2);
});

test('mostExpensiveItem returns the priciest item', () => {
  const items = [
    { name: 'a', price: 10 },
    { name: 'b', price: 25 },
    { name: 'c', price: 5 },
  ];
  assert.equal(mostExpensiveItem(items).name, 'b');
});

test('mostExpensiveItem returns null for an empty list', () => {
  assert.equal(mostExpensiveItem([]), null);
});
