function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function applyMappedInventoryPackageRule(item = {}, vendorProduct = null) {
  const packSize = Math.max(1, Math.round(positiveNumber(vendorProduct?.packSize) || positiveNumber(item.packSize) || 1));
  const mappedUnitPrice = positiveNumber(vendorProduct?.unitPrice);
  const mappedCasePrice = positiveNumber(vendorProduct?.casePrice);
  const caseCost = mappedCasePrice || (mappedUnitPrice ? mappedUnitPrice * packSize : positiveNumber(item.caseCost));
  const unitCost = mappedUnitPrice || (caseCost ? caseCost / packSize : positiveNumber(item.baseUnitCost || item.unitCost));
  return {
    ...item,
    packSize,
    casePackaged: packSize > 1 || item.casePackaged === true,
    caseCost,
    baseUnitCost: unitCost,
    unitCost,
  };
}

