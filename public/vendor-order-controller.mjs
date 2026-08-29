function defaultClean(value) {
  return String(value ?? "").trim();
}

export function getVendorOrderAdjustmentOptionState({
  optionVendor = "",
  currentPlanQuantity = 0,
  selectedVendor = "",
  removing = false,
} = {}) {
  const matchesVendor = !selectedVendor || optionVendor === selectedVendor;
  const isOnOrder = Number(currentPlanQuantity) > 0;
  const hidden = !matchesVendor || (removing && !isOnOrder);
  return { matchesVendor, isOnOrder, hidden, disabled: hidden };
}

export function getVendorOrderBulkRemovalState(removableLines = []) {
  const selectedCount = removableLines.filter((input) => input.checked).length;
  return {
    selectedCount,
    allSelected: removableLines.length > 0 && selectedCount === removableLines.length,
    indeterminate: selectedCount > 0 && selectedCount < removableLines.length,
    disabled: selectedCount === 0,
    label: selectedCount ? `Remove selected (${selectedCount})` : "Remove selected",
  };
}

export function buildVendorOrderBulkRemovalPayload({ vendor, adjustedBy, selected = [] } = {}) {
  return {
    action: "set-order-adjustments",
    vendor,
    adjustedBy,
    adjustments: selected.map((input) => ({
      catalogId: input.value,
      vendor,
      quantity: 0,
      reason: "Removed during draft review.",
    })),
  };
}

export function bindVendorOrderController({
  documentRef = globalThis.document,
  clean = defaultClean,
  rehearsalMode = false,
  getDraftView,
  confirmLateVendorOrder,
  copyAssistedOrderText,
  saveVendorHandoffEvent,
  canBuildVendorCart,
  getVendorCartLabel,
  sendVendorCartRequest,
  openVendorPath,
  setWeeklyOrderTrackingMessage,
  renderWeeklyPlan,
  saveVendorOrderDraftAction,
  confirmDashboardAction,
  saveWeeklyOrderPlaced,
  getReviewAndApproveOrderPolicy,
} = {}) {
  if (typeof documentRef?.querySelectorAll !== "function") return false;

  const setMessage = (message) => setWeeklyOrderTrackingMessage?.(message);

  documentRef.querySelectorAll("[data-assisted-order-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const view = getDraftView?.(button.dataset.assistedOrderCopy);
      if (!view?.order.actionsEnabled) return;
      if (!view.order.rehearsal && !confirmLateVendorOrder?.(view)) return;
      await copyAssistedOrderText?.(view.copyText);
      if (view.order.rehearsal) button.textContent = "Copied";
      else await saveVendorHandoffEvent?.(view, "copied");
    });
  });

  documentRef.querySelectorAll("[data-assisted-order-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const view = getDraftView?.(button.dataset.assistedOrderOpen);
      if (!view?.order.actionsEnabled) return;
      if (!view.order.rehearsal && !confirmLateVendorOrder?.(view)) return;
      if (canBuildVendorCart?.(view.order.vendorKey)) {
        const vendorLabel = getVendorCartLabel?.(view.order) || view.order.vendor;
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = view.order.rehearsal ? `Filling ${vendorLabel} rehearsal...` : `Opening ${vendorLabel}...`;
        try {
          await sendVendorCartRequest?.(view);
          button.textContent = view.order.rehearsal ? `${vendorLabel} rehearsal ready` : `Sent to ${vendorLabel}`;
          if (!view.order.rehearsal) await saveVendorHandoffEvent?.(view, "opened_vendor");
        } catch (error) {
          button.disabled = false;
          button.textContent = originalLabel;
          setMessage(error.message);
        }
        return;
      }
      if (!view.vendorPath) return;
      openVendorPath?.(view);
      await saveVendorHandoffEvent?.(view, "opened_vendor");
    });
  });

  if (rehearsalMode) return true;

  const adjustmentPanel = documentRef.querySelector("[data-order-adjustment-panel]");
  const adjustmentAction = adjustmentPanel?.querySelector("[data-order-adjustment-action]");
  const adjustmentVendor = adjustmentPanel?.querySelector("[data-order-adjustment-vendor-filter]");
  const adjustmentProduct = adjustmentPanel?.querySelector("[data-order-adjustment-product]");
  const adjustmentQuantity = adjustmentPanel?.querySelector("[data-order-adjustment-quantity-input]");
  const adjustmentQuantityField = adjustmentPanel?.querySelector("[data-order-adjustment-quantity-field]");
  const adjustmentReason = adjustmentPanel?.querySelector("[data-order-adjustment-reason-input]");
  const adjustmentUnit = adjustmentPanel?.querySelector("[data-order-adjustment-unit-label]");
  const adjustmentManager = adjustmentPanel?.querySelector("[data-order-adjustment-manager]");

  const syncAdjustmentFields = () => {
    const option = adjustmentProduct?.selectedOptions?.[0];
    if (!option) return;
    if (adjustmentQuantity) adjustmentQuantity.value = option.dataset.orderAdjustmentDefaultQuantity || "1";
    if (adjustmentReason) adjustmentReason.value = option.dataset.orderAdjustmentDefaultReason || "";
    if (adjustmentUnit) adjustmentUnit.textContent = option.dataset.orderAdjustmentQuantityUnit || "units";
    const removing = adjustmentAction?.value === "remove";
    if (adjustmentQuantityField) adjustmentQuantityField.hidden = removing;
    if (adjustmentQuantity) adjustmentQuantity.disabled = removing;
  };

  const syncAdjustmentProducts = () => {
    if (!adjustmentProduct) return;
    const selectedVendor = adjustmentVendor?.value || "";
    const removing = adjustmentAction?.value === "remove";
    const options = [...adjustmentProduct.options];
    options.forEach((option) => {
      const state = getVendorOrderAdjustmentOptionState({
        optionVendor: option.dataset.orderAdjustmentVendor,
        currentPlanQuantity: option.dataset.orderAdjustmentCurrentQuantity,
        selectedVendor,
        removing,
      });
      option.hidden = state.hidden;
      option.disabled = state.disabled;
    });
    if (adjustmentProduct.selectedOptions[0]?.disabled) {
      const firstAvailable = options.find((option) => !option.disabled);
      if (firstAvailable) adjustmentProduct.value = firstAvailable.value;
    }
    syncAdjustmentFields();
  };

  adjustmentAction?.addEventListener("change", syncAdjustmentProducts);
  adjustmentVendor?.addEventListener("change", syncAdjustmentProducts);
  adjustmentProduct?.addEventListener("change", syncAdjustmentFields);
  syncAdjustmentProducts();

  adjustmentPanel?.querySelector("[data-order-adjustment-save]")?.addEventListener("click", async () => {
    const option = adjustmentProduct?.selectedOptions?.[0];
    const adjustedBy = clean(adjustmentManager?.value);
    const reason = clean(adjustmentReason?.value);
    const quantity = Number(adjustmentQuantity?.value);
    const removing = adjustmentAction?.value === "remove";
    if (!option || (!removing && (!Number.isInteger(quantity) || quantity <= 0)) || !reason || !adjustedBy) {
      setMessage(`Choose a product and enter ${removing ? "the" : "its quantity,"} reason and manager.`);
      renderWeeklyPlan?.();
      return;
    }
    await saveVendorOrderDraftAction?.({
      action: "set-order-adjustment",
      catalogId: option.value,
      vendor: option.dataset.orderAdjustmentVendor,
      quantity: removing ? 0 : quantity,
      reason,
      adjustedBy,
    });
  });

  adjustmentPanel?.querySelectorAll("[data-order-adjustment-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const adjustedBy = clean(adjustmentManager?.value);
      if (!adjustedBy) {
        setMessage("Enter the manager removing this adjustment.");
        renderWeeklyPlan?.();
        return;
      }
      await saveVendorOrderDraftAction?.({
        action: "remove-order-adjustment",
        catalogId: button.dataset.orderAdjustmentRemove,
        vendor: button.dataset.orderAdjustmentVendor,
        adjustedBy,
      });
    });
  });

  documentRef.querySelectorAll("[data-weekly-order-place]").forEach((button) => {
    button.addEventListener("click", async () => {
      const vendor = clean(button.dataset.weeklyOrderVendor);
      const orderedBy = clean(button.dataset.weeklyOrderedBy);
      if (!button.dataset.weeklyOrderVendorId || !orderedBy) return;
      if (!confirmDashboardAction?.(
        `Mark the ${vendor} order as placed?`,
        ["This confirms the reviewed order was submitted outside the dashboard."],
      )) return;
      button.disabled = true;
      await saveWeeklyOrderPlaced?.(button.dataset.weeklyOrderVendorId, true, orderedBy);
    });
  });

  documentRef.querySelectorAll("[data-vendor-order-draft]").forEach((form) => {
    const vendor = form.dataset.vendorOrderDraft;
    const managerInput = form.querySelector("[data-order-draft-manager]");
    managerInput?.addEventListener("change", () => {
      const manager = clean(managerInput.value);
      if (!manager) return;
      documentRef.querySelectorAll("[data-order-draft-manager]").forEach((input) => {
        if (!clean(input.value)) input.value = manager;
      });
    });

    const removableLines = [...form.querySelectorAll("[data-order-draft-remove-line]")];
    const selectAll = form.querySelector("[data-order-draft-select-all]");
    const removeSelected = form.querySelector("[data-order-draft-remove-selected]");
    const syncBulkRemoval = () => {
      const state = getVendorOrderBulkRemovalState(removableLines);
      if (selectAll) {
        selectAll.checked = state.allSelected;
        selectAll.indeterminate = state.indeterminate;
      }
      if (removeSelected) {
        removeSelected.disabled = state.disabled;
        removeSelected.textContent = state.label;
      }
    };
    selectAll?.addEventListener("change", () => {
      removableLines.forEach((input) => { input.checked = selectAll.checked; });
      syncBulkRemoval();
    });
    removableLines.forEach((input) => input.addEventListener("change", syncBulkRemoval));
    removeSelected?.addEventListener("click", async () => {
      const adjustedBy = clean(managerInput?.value);
      const selected = removableLines.filter((input) => input.checked);
      if (!adjustedBy) {
        managerInput?.setCustomValidity("Enter the manager adjusting this order.");
        managerInput?.reportValidity();
        return;
      }
      managerInput?.setCustomValidity("");
      if (!selected.length) return;
      removeSelected.disabled = true;
      await saveVendorOrderDraftAction?.(buildVendorOrderBulkRemovalPayload({
        vendor,
        adjustedBy,
        selected,
      }));
    });
    syncBulkRemoval();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const approvedBy = clean(managerInput?.value);
      const confirmed = Boolean(form.querySelector("[data-order-draft-confirm]")?.checked);
      if (!approvedBy) {
        managerInput?.setCustomValidity("Enter the approving manager.");
        managerInput?.reportValidity();
        return;
      }
      managerInput?.setCustomValidity("");
      if (!confirmed) {
        setMessage("Confirm the vendor, total, and line count before approval.");
        renderWeeklyPlan?.();
        return;
      }
      await saveVendorOrderDraftAction?.({
        action: "review-and-approve",
        vendor,
        approvedBy,
        confirmed: true,
        orderPolicy: getReviewAndApproveOrderPolicy?.(),
      });
    });
  });

  return true;
}
