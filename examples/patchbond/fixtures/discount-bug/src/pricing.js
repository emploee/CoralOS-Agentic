export function discountedTotal(price, quantity, discountPercent) {
  const subtotal = price * quantity
  return subtotal - discountPercent
}
