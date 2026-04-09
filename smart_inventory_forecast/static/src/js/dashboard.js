/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillStart, useState, useRef } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";
import { loadJS } from "@web/core/assets";

export class InventoryForecastDashboard extends Component {
    setup() {
        this.state = useState({
            topProducts: [],
            suggestions: [],
            deadStock: [],
            seasonalData: [],
            selectedProducts: new Set(),
            loading: true,
            suggestionLoading: false,
            deadStockLoading: false,
            seasonalLoading: false,
            poCreated: false,
            poId: null,
            poName: null,
            activeTab: "chart",
            autoPOs: [],
            productPoMap: {},
            manualPoMap: {},
            autoPoLoading: false,
            showVendorModal: false,
            vendorSearchTerm: "",
            vendorSearchResults: [],
            vendorSearchLoading: false,
            chosenVendorId: null,
            chosenVendorName: "",
            chartDateFrom: "",
            chartDateTo: "",
            chartType: "pie",
            chartTopN: "6",
            chartCategory: "all",
            chartCategories: [],
            analyticsLoading: false,
            analyticsDateFrom: "",
            analyticsDateTo: "",
            analyticsData: [],
            analyticsSearchResults: [],
            analyticsSearchLoading: false,
            analyticsSelectedProduct: null,
            analyticsSearchTerm: "",
            analyticsShowDropdown: false,
            // ── Manufacturing tab ─────────────────────────────
            mfgLoading: false,
            mfgOrders: [],
            mfgBomStock: [],
            mfgShortages: [],
            mfgDateFrom: "",
            mfgDateTo: "",
            mfgActiveSubTab: "orders",
            mfgModuleInstalled: false,
        });
        this.chartRef = useRef("chartCanvas");
        this._analyticsSearchTimeout = null;

        onWillStart(async () => {
            await loadJS("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js");
            await loadJS("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");

            try {
                const saved = localStorage.getItem("inv_forecast_manualPoMap");
                if (saved) {
                    const restored = JSON.parse(saved);
                    const poIds = [...new Set(Object.values(restored).map(p => p.poId))];
                    if (poIds.length) {
                        const valid = await rpc("/web/dataset/call_kw", {
                            model: "purchase.order", method: "search_read",
                            args: [[["id", "in", poIds], ["state", "=", "draft"]]],
                            kwargs: { fields: ["id", "name"], limit: 200 },
                        });
                        const validIds = new Set(valid.map(p => p.id));
                        const validMap = {};
                        Object.entries(restored).forEach(([pid, po]) => {
                            if (validIds.has(po.poId)) validMap[pid] = po;
                        });
                        this.state.manualPoMap = validMap;
                        localStorage.setItem("inv_forecast_manualPoMap", JSON.stringify(validMap));
                    }
                }
            } catch(e) { console.warn("manualPoMap restore failed", e); }

            await this._loadChartCategories();
            await this._loadSalesData();
            await this._loadPurchaseSuggestions();
            await this._loadDeadStock();
            await this._loadSeasonalDemand();
            await this._loadAnalyticsData();
            await this._checkMfgModule();
        });

        onMounted(() => { this._renderChart(); });
    }

    // ── Chart Categories ──────────────────────────────────────────────────────
    async _loadChartCategories() {
        const cats = await rpc("/web/dataset/call_kw", {
            model: "product.category", method: "search_read",
            args: [[]], kwargs: { fields: ["id", "name"], limit: 50 },
        });
        this.state.chartCategories = cats;
    }

    // ── 1. Demand Chart ───────────────────────────────────────────────────────
    async _loadSalesData() {
        this.state.loading = true;
        const topN = parseInt(this.state.chartTopN, 10);
        const domain = [["order_id.state", "in", ["sale", "done"]]];
        if (this.state.chartDateFrom) domain.push(["order_id.date_order", ">=", this.state.chartDateFrom]);
        if (this.state.chartDateTo)   domain.push(["order_id.date_order", "<=", this.state.chartDateTo + " 23:59:59"]);
        if (this.state.chartCategory !== "all") domain.push(["product_id.categ_id", "=", parseInt(this.state.chartCategory, 10)]);
        const lines = await rpc("/web/dataset/call_kw", {
            model: "sale.order.line", method: "read_group",
            args: [domain, ["product_id", "product_uom_qty"], ["product_id"]],
            kwargs: { orderby: "product_uom_qty desc", limit: topN },
        });
        this.state.topProducts = lines.map((l) => ({ name: l.product_id[1], id: l.product_id[0], qty: l.product_uom_qty }));
        this.state.loading = false;
        setTimeout(() => this._renderChart(), 50);
    }

    async applyChartFilters() { await this._loadSalesData(); }
    async resetChartFilters() {
        this.state.chartDateFrom = ""; this.state.chartDateTo = "";
        this.state.chartTopN = "6"; this.state.chartCategory = "all";
        await this._loadSalesData();
    }
    onChartDateFrom(ev)       { this.state.chartDateFrom  = ev.target.value; }
    onChartDateTo(ev)         { this.state.chartDateTo    = ev.target.value; }
    onChartTypeChange(ev)     { this.state.chartType      = ev.target.value; }
    onChartTopNChange(ev)     { this.state.chartTopN      = ev.target.value; }
    onChartCategoryChange(ev) { this.state.chartCategory  = ev.target.value; }

    // ── 2. Purchase Suggestions ───────────────────────────────────────────────
    async _loadPurchaseSuggestions() {
        this.state.suggestionLoading = true;
        const since = this._nMonthsAgo(2);
        const salesLines = await rpc("/web/dataset/call_kw", {
            model: "sale.order.line", method: "read_group",
            args: [[["order_id.state", "in", ["sale", "done"]], ["order_id.date_order", ">=", since]], ["product_id", "product_uom_qty"], ["product_id"]],
            kwargs: { orderby: "product_uom_qty desc", limit: 20 },
        });
        if (!salesLines.length) { this.state.suggestionLoading = false; return; }
        const productIds = salesLines.map((l) => l.product_id[0]);
        const stockData = await rpc("/web/dataset/call_kw", {
            model: "product.product", method: "read",
            args: [productIds, ["id", "name", "qty_available", "uom_id", "product_tmpl_id"]], kwargs: {},
        });
        const stockMap = {}; const tmplMap = {};
        stockData.forEach((p) => {
            stockMap[p.id] = { stock: p.qty_available, uom: p.uom_id ? p.uom_id[1] : "Units" };
            if (p.product_tmpl_id) tmplMap[p.id] = p.product_tmpl_id[0];
        });
        const tmplIds = [...new Set(Object.values(tmplMap))];
        const supplierData = await rpc("/web/dataset/call_kw", {
            model: "product.supplierinfo", method: "search_read",
            args: [["|", ["product_id", "in", productIds], ["product_tmpl_id", "in", tmplIds]]],
            kwargs: { fields: ["product_id", "product_tmpl_id", "partner_id", "price", "min_qty"], limit: 200 },
        });
        const vendorMap = {};
        supplierData.forEach((s) => {
            const pid = s.product_id ? s.product_id[0] : null;
            const tmplId = s.product_tmpl_id ? s.product_tmpl_id[0] : null;
            const entry = { partnerId: s.partner_id[0], partnerName: s.partner_id[1], price: s.price, minQty: s.min_qty || 1 };
            if (pid && productIds.includes(pid)) { if (!vendorMap[pid]) vendorMap[pid] = entry; }
            else if (tmplId) { Object.entries(tmplMap).forEach(([productId, tId]) => { if (tId === tmplId && !vendorMap[+productId]) vendorMap[+productId] = entry; }); }
        });
        const suggestions = [];
        salesLines.forEach((l) => {
            const pid = l.product_id[0]; const soldQty = l.product_uom_qty;
            const monthlyAvgDemand = soldQty / 2;
            const stock = stockMap[pid] ? stockMap[pid].stock : 0;
            const uom = stockMap[pid] ? stockMap[pid].uom : "Units";
            const vendor = vendorMap[pid] || null;
            if (stock < monthlyAvgDemand) {
                suggestions.push({
                    productId: pid, productName: l.product_id[1],
                    soldLast2Months: soldQty, monthlyAvgDemand: monthlyAvgDemand.toFixed(1),
                    currentStock: stock.toFixed(1), suggestQty: Math.ceil(monthlyAvgDemand * 2 - stock),
                    uom, vendorId: vendor ? vendor.partnerId : null,
                    vendorName: vendor ? vendor.partnerName : "No vendor set",
                    unitPrice: vendor ? vendor.price : 0,
                    status: stock <= 0 ? "critical" : "low",
                });
            }
        });
        this.state.suggestions = suggestions;
        this.state.suggestionLoading = false;
        if (suggestions.length) await this._autoCreateDraftPOs(suggestions);
    }

    async _autoCreateDraftPOs(suggestions) {
        this.state.autoPoLoading = true;
        const withVendor = suggestions.filter((s) => s.vendorId);
        if (!withVendor.length) { this.state.autoPoLoading = false; return; }
        const byVendor = {};
        withVendor.forEach((s) => {
            if (!byVendor[s.vendorId]) byVendor[s.vendorId] = { vendorId: s.vendorId, vendorName: s.vendorName, lines: [] };
            byVendor[s.vendorId].lines.push(s);
        });
        const vendorIds = Object.keys(byVendor).map(Number);
        const ORIGIN_TAG = "[InventoryForecast]";
        const existingPOs = await rpc("/web/dataset/call_kw", {
            model: "purchase.order", method: "search_read",
            args: [[["partner_id", "in", vendorIds], ["state", "=", "draft"], ["origin", "like", ORIGIN_TAG]]],
            kwargs: { fields: ["id", "name", "partner_id"], limit: 50 },
        });
        const existingPoByVendor = {};
        existingPOs.forEach((po) => {
            const vid = po.partner_id[0];
            if (!existingPoByVendor[vid] || po.id > existingPoByVendor[vid].id) existingPoByVendor[vid] = po;
        });
        const autoPOs = [];
        const now = new Date(); const datePlanned = now.toISOString().replace("T", " ").substring(0, 19);
        for (const group of Object.values(byVendor)) {
            const existing = existingPoByVendor[group.vendorId];
            if (existing) {
                autoPOs.push({ vendorId: group.vendorId, vendorName: group.vendorName, poId: existing.id, poName: existing.name, productIds: group.lines.map(l => l.productId), reused: true });
            } else {
                const poLines = group.lines.map((s) => [0, 0, { product_id: s.productId, product_qty: s.suggestQty, price_unit: s.unitPrice || 0, name: s.productName, date_planned: datePlanned }]);
                try {
                    const poId = await rpc("/web/dataset/call_kw", { model: "purchase.order", method: "create", args: [{ partner_id: group.vendorId, order_line: poLines, origin: ORIGIN_TAG }], kwargs: {} });
                    const poData = await rpc("/web/dataset/call_kw", { model: "purchase.order", method: "read", args: [[poId], ["name"]], kwargs: {} });
                    autoPOs.push({ vendorId: group.vendorId, vendorName: group.vendorName, poId, poName: poData[0].name, productIds: group.lines.map(l => l.productId), reused: false });
                } catch(e) { console.error("Auto-PO creation failed for vendor:", group.vendorName, e); }
            }
        }
        const productPoMap = {};
        autoPOs.forEach((po) => { po.productIds.forEach((pid) => { productPoMap[pid] = po; }); });
        this.state.autoPOs = autoPOs; this.state.productPoMap = productPoMap; this.state.autoPoLoading = false;
    }

    openAutoPO(productId) {
        const po = this.getProductPO(productId);
        if (po) window.open(`/web#model=purchase.order&id=${po.poId}&view_type=form`, "_blank");
    }
    getProductPO(productId) {
        return (this.state.manualPoMap && this.state.manualPoMap[productId]) ||
               (this.state.productPoMap && this.state.productPoMap[productId]) || null;
    }
    toggleProduct(productId) {
        const sel = new Set(this.state.selectedProducts);
        sel.has(productId) ? sel.delete(productId) : sel.add(productId);
        this.state.selectedProducts = sel;
    }
    toggleSelectAll() {
        this.state.selectedProducts = this.state.selectedProducts.size === this.state.suggestions.length
            ? new Set()
            : new Set(this.state.suggestions.map((s) => s.productId));
    }
    isSelected(productId) { return this.state.selectedProducts.has(productId); }
    get allSelected()   { return this.state.suggestions.length > 0 && this.state.selectedProducts.size === this.state.suggestions.length; }
    get someSelected()  { return this.state.selectedProducts.size > 0; }
    get selectedCount() { return this.state.selectedProducts.size; }

    // ── 3. Create PO (manual) ─────────────────────────────────────────────────
    async createPurchaseOrder() {
        const suggestions = this.state.suggestions.filter((s) => this.state.selectedProducts.has(s.productId));
        if (!suggestions.length) return;
        const firstVendorGroup = this._getFirstVendorGroup(suggestions);
        if (!firstVendorGroup) {
            this.state.showVendorModal = true; this.state.vendorSearchTerm = "";
            this.state.vendorSearchResults = []; this.state.chosenVendorId = null; this.state.chosenVendorName = "";
            return;
        }
        await this._doCreatePO(suggestions, firstVendorGroup.vendorId, "");
    }
    async createPOWithChosenVendor() {
        if (!this.state.chosenVendorId) return;
        const suggestions = this.state.suggestions.filter((s) => this.state.selectedProducts.has(s.productId));
        this.state.showVendorModal = false;
        await this._doCreatePO(suggestions, this.state.chosenVendorId, this.state.chosenVendorName);
    }
    _getFirstVendorGroup(suggestions) {
        const byVendor = {};
        suggestions.forEach((s) => {
            const key = s.vendorId || "unknown";
            if (!byVendor[key]) byVendor[key] = { vendorId: s.vendorId, lines: [] };
            byVendor[key].lines.push(s);
        });
        return Object.values(byVendor).find((g) => g.vendorId) || null;
    }
    async _doCreatePO(suggestions, vendorId, vendorName) {
        const now = new Date(); const datePlanned = now.toISOString().replace("T", " ").substring(0, 19);
        const poLines = suggestions.map((s) => [0, 0, { product_id: s.productId, product_qty: s.suggestQty, price_unit: s.unitPrice || 0, name: s.productName, date_planned: datePlanned }]);
        const poId = await rpc("/web/dataset/call_kw", { model: "purchase.order", method: "create", args: [{ partner_id: vendorId, order_line: poLines, notes: "Auto-generated by Inventory Forecast Dashboard." }], kwargs: {} });
        const poData = await rpc("/web/dataset/call_kw", { model: "purchase.order", method: "read", args: [[poId], ["name", "partner_id"]], kwargs: {} });
        const resolvedVendorName = vendorName || (poData[0].partner_id && poData[0].partner_id[1]) || "";
        this.state.poCreated = true; this.state.poId = poId; this.state.poName = poData[0].name;
        const manualPoMap = Object.assign({}, this.state.manualPoMap);
        suggestions.forEach((s) => { manualPoMap[s.productId] = { poId, poName: poData[0].name, vendorName: resolvedVendorName, manual: true, reused: false }; });
        this.state.manualPoMap = manualPoMap;
        try { localStorage.setItem("inv_forecast_manualPoMap", JSON.stringify(manualPoMap)); } catch(e) {}
    }
    async searchVendors() {
        const term = this.state.vendorSearchTerm.trim(); if (!term) return;
        this.state.vendorSearchLoading = true;
        const results = await rpc("/web/dataset/call_kw", { model: "res.partner", method: "search_read", args: [[["name", "ilike", term], ["supplier_rank", ">", 0]]], kwargs: { fields: ["id", "name", "email", "phone"], limit: 10 } });
        this.state.vendorSearchResults = results; this.state.vendorSearchLoading = false;
    }
    onVendorSearchInput(ev) {
        this.state.vendorSearchTerm = ev.target.value;
        clearTimeout(this._vendorSearchTimeout);
        this._vendorSearchTimeout = setTimeout(() => this.searchVendors(), 400);
    }
    selectVendor(id, name) { this.state.chosenVendorId = id; this.state.chosenVendorName = name; this.state.vendorSearchResults = []; this.state.vendorSearchTerm = name; }
    closeVendorModal() { this.state.showVendorModal = false; }
    openPO() { if (this.state.poId) window.location.href = `/web#model=purchase.order&id=${this.state.poId}&view_type=form`; }

    // ── 4. Dead Stock ─────────────────────────────────────────────────────────
    async _loadDeadStock() {
        this.state.deadStockLoading = true;
        const since = this._nMonthsAgo(12);
        const recentSales = await rpc("/web/dataset/call_kw", {
            model: "sale.order.line", method: "read_group",
            args: [[["order_id.state", "in", ["sale", "done"]], ["order_id.date_order", ">=", since]], ["product_id", "product_uom_qty"], ["product_id"]],
            kwargs: { orderby: "product_uom_qty desc", limit: 200 },
        });
        const activeSoldIds = new Set(recentSales.map((l) => l.product_id[0]));
        const inStockProducts = await rpc("/web/dataset/call_kw", {
            model: "product.product", method: "search_read",
            args: [[["qty_available", ">", 0], ["type", "in", ["product", "consu"]], ["active", "=", true]]],
            kwargs: { fields: ["id", "name", "qty_available", "uom_id", "categ_id", "list_price", "standard_price"], limit: 200 },
        });
        const deadItems = inStockProducts
            .filter((p) => !activeSoldIds.has(p.id))
            .map((p) => {
                const stockValue = p.qty_available * p.standard_price;
                return { productId: p.id, productName: p.name, stock: p.qty_available.toFixed(1), uom: p.uom_id ? p.uom_id[1] : "Units", category: p.categ_id ? p.categ_id[1] : "Uncategorized", salePrice: p.list_price, costPrice: p.standard_price, stockValue: stockValue.toFixed(2), severity: stockValue > 1000 ? "high" : stockValue > 200 ? "medium" : "low" };
            })
            .sort((a, b) => parseFloat(b.stockValue) - parseFloat(a.stockValue))
            .slice(0, 30);
        this.state.deadStock = deadItems; this.state.deadStockLoading = false;
    }
    get totalDeadStockValue() { return this.state.deadStock.reduce((sum, p) => sum + parseFloat(p.stockValue), 0).toFixed(2); }
    get deadStockBySeverity() {
        return {
            high:   this.state.deadStock.filter(p => p.severity === "high").length,
            medium: this.state.deadStock.filter(p => p.severity === "medium").length,
            low:    this.state.deadStock.filter(p => p.severity === "low").length,
        };
    }
    openProduct(productId) { window.location.href = `/web#model=product.product&id=${productId}&view_type=form`; }

    // ── 5. Seasonal Demand ────────────────────────────────────────────────────
    async _loadSeasonalDemand() {
        this.state.seasonalLoading = true;
        const OUTLIER_THRESHOLD = 5; const CLEARANCE_SPIKE_MX = 3;
        const since = this._nMonthsAgo(13);
        const lines = await rpc("/web/dataset/call_kw", {
            model: "sale.order.line", method: "search_read",
            args: [[["order_id.state", "in", ["sale", "done"]], ["order_id.date_order", ">=", since]]],
            kwargs: { fields: ["product_id", "product_uom_qty", "order_id"], limit: 5000 },
        });
        if (!lines.length) { this.state.seasonalLoading = false; return; }
        const orderIds = [...new Set(lines.map(l => l.order_id[0]))];
        const orders = await rpc("/web/dataset/call_kw", { model: "sale.order", method: "read", args: [orderIds, ["id", "date_order"]], kwargs: {} });
        const orderDateMap = {};
        orders.forEach(o => { orderDateMap[o.id] = o.date_order; });
        const salesByProductMonth = {};
        lines.forEach(l => {
            const pid = l.product_id[0]; const pname = l.product_id[1];
            const dateStr = orderDateMap[l.order_id[0]]; if (!dateStr) return;
            const d = new Date(dateStr);
            const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
            if (!salesByProductMonth[pid]) salesByProductMonth[pid] = { name: pname, months: {} };
            salesByProductMonth[pid].months[monthKey] = (salesByProductMonth[pid].months[monthKey] || 0) + l.product_uom_qty;
        });
        const now = new Date();
        const currentMonth = now.getMonth(); const currentYear = now.getFullYear();
        const nextMonth = (currentMonth + 1) % 12; const nextMonthYear = nextMonth === 0 ? currentYear + 1 : currentYear;
        const currentMonthKey    = `${currentYear}-${String(currentMonth+1).padStart(2,"0")}`;
        const lastYearCurrentKey = `${currentYear-1}-${String(currentMonth+1).padStart(2,"0")}`;
        const lastYearNextKey    = `${currentYear-1}-${String(nextMonth+1).padStart(2,"0")}`;
        const lyAfterNextMonth   = (nextMonth + 1) % 12;
        const lyAfterNextKey     = `${currentYear-1}-${String(lyAfterNextMonth+1).padStart(2,"0")}`;
        const nextMonthLabel     = new Date(nextMonthYear, nextMonth, 1).toLocaleString("default", { month: "long", year: "numeric" });
        const allProductIds = Object.keys(salesByProductMonth).map(Number);
        const stockRecords = await rpc("/web/dataset/call_kw", { model: "product.product", method: "read", args: [allProductIds, ["id", "qty_available", "uom_id"]], kwargs: {} });
        const stockMap = {};
        stockRecords.forEach(p => { stockMap[p.id] = { stock: p.qty_available, uom: p.uom_id ? p.uom_id[1] : "Units" }; });
        const results = [];
        for (const [pidStr, data] of Object.entries(salesByProductMonth)) {
            const pid = Number(pidStr); const months = data.months;
            const allQtys = Object.values(months); const avgQty = allQtys.reduce((a,b)=>a+b,0) / (allQtys.length || 1);
            const currentQty = months[currentMonthKey] || 0; const lyCurrentQty = months[lastYearCurrentKey] || 0;
            const lyNextQty = months[lastYearNextKey] || 0; const lyAfterNextQty = months[lyAfterNextKey] || 0;
            const isExtremeSpike = lyNextQty > OUTLIER_THRESHOLD * avgQty;
            const isClearanceSale = lyNextQty > CLEARANCE_SPIKE_MX * avgQty && lyCurrentQty < avgQty && lyAfterNextQty < avgQty;
            const isOutlier = isExtremeSpike || isClearanceSale;
            const outlierReason = isExtremeSpike ? "Extreme spike (5x avg)" : isClearanceSale ? "Clearance pattern detected" : null;
            const seasonalIndex = (!isOutlier && lyCurrentQty > 0) ? lyNextQty / lyCurrentQty : 1;
            const projectedDemand = Math.ceil(currentQty * seasonalIndex);
            const stockInfo = stockMap[pid] || { stock: 0, uom: "Units" };
            const gap = projectedDemand - stockInfo.stock;
            const suggestOrder = gap > 0 ? Math.ceil(gap) : 0;
            const status = seasonalIndex > 1.2 ? "spike" : seasonalIndex < 0.8 ? "drop" : "stable";
            results.push({ productId: pid, productName: data.name, currentSales: currentQty.toFixed(0), lyCurrentSales: lyCurrentQty.toFixed(0), lyNextSales: lyNextQty.toFixed(0), lyAfterNextSales: lyAfterNextQty.toFixed(0), seasonalIndex: seasonalIndex.toFixed(2), projectedDemand, currentStock: stockInfo.stock.toFixed(1), suggestOrder, uom: stockInfo.uom, status, isOutlier, outlierReason, nextMonth: nextMonthLabel });
        }
        const sortOrder = { spike: 0, stable: 1, drop: 2 };
        results.sort((a, b) => (sortOrder[a.status] - sortOrder[b.status]) || b.suggestOrder - a.suggestOrder);
        this.state.seasonalData = results.slice(0, 25); this.state.seasonalLoading = false;
    }
    get seasonalSpikes()         { return this.state.seasonalData.filter(p => p.status === "spike").length; }
    get seasonalDrops()          { return this.state.seasonalData.filter(p => p.status === "drop").length; }
    get seasonalStable()         { return this.state.seasonalData.filter(p => p.status === "stable").length; }
    get seasonalNextMonthLabel() { return this.state.seasonalData.length ? this.state.seasonalData[0].nextMonth : "—"; }

    // ── 6. Product Analytics ──────────────────────────────────────────────────
    async _loadAnalyticsData() {
        this.state.analyticsLoading = true;
        const dateFrom = this.state.analyticsDateFrom;
        const dateTo   = this.state.analyticsDateTo;
        const saleDomain = [["order_id.state", "in", ["sale", "done"]]];
        if (dateFrom) saleDomain.push(["order_id.date_order", ">=", dateFrom]);
        if (dateTo)   saleDomain.push(["order_id.date_order", "<=", dateTo + " 23:59:59"]);
        if (this.state.analyticsSelectedProduct) saleDomain.push(["product_id", "=", this.state.analyticsSelectedProduct.id]);
        const saleLines = await rpc("/web/dataset/call_kw", {
            model: "sale.order.line", method: "read_group",
            args: [saleDomain, ["product_id", "product_uom_qty", "price_subtotal", "price_tax", "price_total"], ["product_id"]],
            kwargs: { orderby: "price_subtotal desc", limit: 50 },
        });
        if (!saleLines.length) { this.state.analyticsData = []; this.state.analyticsLoading = false; return; }
        const productIds = saleLines.map(l => l.product_id[0]);
        const productDetails = await rpc("/web/dataset/call_kw", {
            model: "product.product", method: "read",
            args: [productIds, ["id", "standard_price", "uom_id", "categ_id"]], kwargs: {},
        });
        const costMap = {};
        productDetails.forEach(p => { costMap[p.id] = { cost: p.standard_price, uom: p.uom_id ? p.uom_id[1] : "Units", category: p.categ_id ? p.categ_id[1] : "—" }; });
        const purchaseDomain = [["order_id.state", "!=", "cancel"], ["product_id", "in", productIds]];
        const purchaseLines = await rpc("/web/dataset/call_kw", {
            model: "purchase.order.line", method: "search_read",
            args: [purchaseDomain],
            kwargs: { fields: ["product_id", "product_qty", "price_subtotal", "price_total", "price_tax", "price_unit"], limit: 500 },
        });
        const purchaseMap = {};
        purchaseLines.forEach(l => {
            const pid = l.product_id[0];
            const subtotal = l.price_subtotal || 0; const tax = l.price_tax || 0; const total = l.price_total || (subtotal + tax);
            if (!purchaseMap[pid]) purchaseMap[pid] = { qty: 0, subtotal: 0, tax: 0, total: 0 };
            purchaseMap[pid].qty += l.product_qty || 0; purchaseMap[pid].subtotal += subtotal; purchaseMap[pid].tax += tax; purchaseMap[pid].total += total;
        });
        const data = saleLines.map(l => {
            const pid = l.product_id[0]; const soldQty = l.product_uom_qty || 0;
            const salesUntaxed = l.price_subtotal || 0; const salesTax = l.price_tax || 0; const salesTotal = l.price_total || (salesUntaxed + salesTax);
            const costInfo = costMap[pid] || { cost: 0, uom: "Units", category: "—" };
            const purchInfo = purchaseMap[pid] || { qty: 0, subtotal: 0, tax: 0, total: 0 };
            const cogs = soldQty * costInfo.cost; const grossProfit = salesUntaxed - cogs; const grossMargin = salesUntaxed > 0 ? (grossProfit / salesUntaxed * 100) : 0;
            return { productId: pid, productName: l.product_id[1], soldQty: soldQty.toFixed(1), salesUntaxed: salesUntaxed.toFixed(2), salesTax: salesTax.toFixed(2), salesTotal: salesTotal.toFixed(2), purchaseQty: purchInfo.qty.toFixed(1), purchaseUntaxed: purchInfo.subtotal.toFixed(2), purchaseTax: purchInfo.tax.toFixed(2), purchaseTotal: purchInfo.total.toFixed(2), salesValue: salesUntaxed.toFixed(2), purchaseValue: purchInfo.subtotal.toFixed(2), cogs: cogs.toFixed(2), grossProfit: grossProfit.toFixed(2), grossProfitNum: grossProfit, grossMargin: grossMargin.toFixed(1), grossMarginNum: grossMargin, uom: costInfo.uom, category: costInfo.category };
        });
        this.state.analyticsData = data; this.state.analyticsLoading = false;
    }
    onAnalyticsDateFrom(ev) { this.state.analyticsDateFrom = ev.target.value; }
    onAnalyticsDateTo(ev)   { this.state.analyticsDateTo   = ev.target.value; }
    async applyAnalyticsFilters() { await this._loadAnalyticsData(); }
    async resetAnalyticsFilters() {
        this.state.analyticsDateFrom = ""; this.state.analyticsDateTo = "";
        this.state.analyticsSelectedProduct = null; this.state.analyticsSearchTerm = "";
        this.state.analyticsSearchResults = []; this.state.analyticsShowDropdown = false;
        await this._loadAnalyticsData();
    }
    onAnalyticsSearchInput(ev) {
        this.state.analyticsSearchTerm = ev.target.value;
        if (!ev.target.value.trim()) { this.state.analyticsSelectedProduct = null; this.state.analyticsSearchResults = []; this.state.analyticsShowDropdown = false; return; }
        clearTimeout(this._analyticsSearchTimeout);
        this._analyticsSearchTimeout = setTimeout(() => this._searchAnalyticsProduct(), 350);
    }
    async _searchAnalyticsProduct() {
        const term = this.state.analyticsSearchTerm.trim(); if (!term) return;
        this.state.analyticsSearchLoading = true;
        const results = await rpc("/web/dataset/call_kw", { model: "product.product", method: "search_read", args: [[["name", "ilike", term], ["active", "=", true]]], kwargs: { fields: ["id", "name"], limit: 10 } });
        this.state.analyticsSearchResults = results; this.state.analyticsShowDropdown = results.length > 0; this.state.analyticsSearchLoading = false;
    }
    selectAnalyticsProduct(id, name) { this.state.analyticsSelectedProduct = { id, name }; this.state.analyticsSearchTerm = name; this.state.analyticsShowDropdown = false; this.state.analyticsSearchResults = []; }
    clearAnalyticsProduct() { this.state.analyticsSelectedProduct = null; this.state.analyticsSearchTerm = ""; this.state.analyticsShowDropdown = false; }

    get analyticsTotals() {
        const d = this.state.analyticsData;
        return {
            salesValue:    d.reduce((s, r) => s + parseFloat(r.salesValue), 0).toFixed(2),
            purchaseValue: d.reduce((s, r) => s + parseFloat(r.purchaseValue), 0).toFixed(2),
            grossProfit:   d.reduce((s, r) => s + parseFloat(r.grossProfit), 0).toFixed(2),
            soldQty:       d.reduce((s, r) => s + parseFloat(r.soldQty), 0).toFixed(1),
        };
    }
    get analyticsTotalSalesQty()      { return this.analyticsTotals.soldQty; }
    get analyticsTotalSales()         { return this.analyticsTotals.salesValue; }
    get analyticsTotalSalesTax()      { return this.state.analyticsData.reduce((s, r) => s + parseFloat(r.salesTax), 0).toFixed(2); }
    get analyticsTotalSalesGross()    { return this.state.analyticsData.reduce((s, r) => s + parseFloat(r.salesTotal), 0).toFixed(2); }
    get analyticsTotalPurchaseQty()   { return this.state.analyticsData.reduce((s, r) => s + parseFloat(r.purchaseQty), 0).toFixed(1); }
    get analyticsTotalPurchase()      { return this.analyticsTotals.purchaseValue; }
    get analyticsTotalPurchaseTax()   { return this.state.analyticsData.reduce((s, r) => s + parseFloat(r.purchaseTax), 0).toFixed(2); }
    get analyticsTotalPurchaseGross() { return this.state.analyticsData.reduce((s, r) => s + parseFloat(r.purchaseTotal), 0).toFixed(2); }
    get analyticsTotalCOGS()          { return this.state.analyticsData.reduce((s, r) => s + parseFloat(r.cogs), 0).toFixed(2); }
    get analyticsTotalProfit()        { return this.analyticsTotals.grossProfit; }
    get analyticsTotalMargin() {
        const sv = parseFloat(this.analyticsTotals.salesValue);
        const gp = parseFloat(this.analyticsTotals.grossProfit);
        return sv > 0 ? (gp / sv * 100).toFixed(1) : "0.0";
    }

    // ── 7. Manufacturing ──────────────────────────────────────────────────────
    async _checkMfgModule() {
        try {
            const result = await rpc("/web/dataset/call_kw", {
                model: "ir.module.module", method: "search_read",
                args: [[["name", "=", "mrp"], ["state", "=", "installed"]]],
                kwargs: { fields: ["id", "name", "state"], limit: 1 },
            });
            if (result.length) {
                this.state.mfgModuleInstalled = true;
                await this._loadManufacturingData();
            }
        } catch(e) {
            console.warn("Could not check mrp module status", e);
            this.state.mfgModuleInstalled = false;
        }
    }

    onMfgDateFrom(ev) { this.state.mfgDateFrom = ev.target.value; }
    onMfgDateTo(ev)   { this.state.mfgDateTo   = ev.target.value; }
    setMfgSubTab(tab) { this.state.mfgActiveSubTab = tab; }
    async applyMfgFilters() { await this._loadManufacturingData(); }
    async resetMfgFilters() { this.state.mfgDateFrom = ""; this.state.mfgDateTo = ""; await this._loadManufacturingData(); }

    async _loadManufacturingData() {
        this.state.mfgLoading = true;
        await Promise.all([
            this._loadMfgOrders(),
            this._loadBomStockCheck(),
            this._loadComponentShortages(),
        ]);
        this.state.mfgLoading = false;
    }

    async _loadMfgOrders() {
        try {
            const domain = [["state", "not in", ["cancel"]]];
            if (this.state.mfgDateFrom) domain.push(["date_start", ">=", this.state.mfgDateFrom]);
            if (this.state.mfgDateTo)   domain.push(["date_start", "<=", this.state.mfgDateTo + " 23:59:59"]);
            const orders = await rpc("/web/dataset/call_kw", {
                model: "mrp.production", method: "search_read",
                args: [domain],
                kwargs: { fields: ["id", "name", "product_id", "product_qty", "product_uom_id", "state", "date_start", "date_finished", "origin"], limit: 80, order: "date_start asc" },
            });
            const stateLabel = {
                draft:     { label: "Draft",       cls: "bg-secondary" },
                confirmed: { label: "Confirmed",   cls: "bg-primary"   },
                progress:  { label: "In Progress", cls: "bg-warning text-dark" },
                to_close:  { label: "To Close",    cls: "bg-info text-dark"    },
                done:      { label: "Done",        cls: "bg-success"   },
            };
            this.state.mfgOrders = orders.map(o => ({
                id:         o.id,
                name:       o.name,
                product:    o.product_id ? o.product_id[1] : "—",
                qty:        o.product_qty,
                uom:        o.product_uom_id ? o.product_uom_id[1] : "",
                state:      o.state,
                stateLabel: stateLabel[o.state] ? stateLabel[o.state].label : o.state,
                stateCls:   stateLabel[o.state] ? stateLabel[o.state].cls  : "bg-secondary",
                origin:     o.origin || "—",
                dateStart:  o.date_start    ? o.date_start.substring(0, 10)    : "—",
                dateEnd:    o.date_finished ? o.date_finished.substring(0, 10) : "—",
                isLate:     o.date_finished && o.state !== "done" && new Date(o.date_finished) < new Date(),
            }));
        } catch(e) { console.warn("_loadMfgOrders failed", e); this.state.mfgOrders = []; }
    }

    async _loadBomStockCheck() {
        try {
            if (this.state.mfgDateFrom || this.state.mfgDateTo) {
                const moDomain = [["state", "not in", ["cancel"]]];
                if (this.state.mfgDateFrom) moDomain.push(["date_start", ">=", this.state.mfgDateFrom]);
                if (this.state.mfgDateTo)   moDomain.push(["date_start", "<=", this.state.mfgDateTo + " 23:59:59"]);
                const activeMOs = await rpc("/web/dataset/call_kw", {
                    model: "mrp.production", method: "search_read",
                    args: [moDomain],
                    kwargs: { fields: ["bom_id"], limit: 200 },
                });
                if (!activeMOs.length) { this.state.mfgBomStock = []; return; }
                const bomIds = [...new Set(activeMOs.filter(m => m.bom_id).map(m => m.bom_id[0]))];
                if (!bomIds.length) { this.state.mfgBomStock = []; return; }
                return await this._fetchAndMapBoms([["id", "in", bomIds]]);
            }
            await this._fetchAndMapBoms([["active", "=", true]]);
        } catch(e) { console.warn("_loadBomStockCheck failed", e); this.state.mfgBomStock = []; }
    }

    async _fetchAndMapBoms(bomDomain) {
        const boms = await rpc("/web/dataset/call_kw", {
            model: "mrp.bom", method: "search_read",
            args: [bomDomain],
            kwargs: { fields: ["id", "product_tmpl_id", "product_qty", "product_uom_id"], limit: 30 },
        });
        if (!boms.length) { this.state.mfgBomStock = []; return; }
        const bomIds = boms.map(b => b.id);
        const bomLines = await rpc("/web/dataset/call_kw", {
            model: "mrp.bom.line", method: "search_read",
            args: [[["bom_id", "in", bomIds]]],
            kwargs: { fields: ["bom_id", "product_id", "product_qty", "product_uom_id"], limit: 500 },
        });
        const compIds = [...new Set(bomLines.map(l => l.product_id[0]))];
        const stockData = compIds.length ? await rpc("/web/dataset/call_kw", {
            model: "product.product", method: "read",
            args: [compIds, ["id", "qty_available"]], kwargs: {},
        }) : [];
        const stockMap = {};
        stockData.forEach(p => { stockMap[p.id] = p.qty_available; });
        const linesByBom = {};
        bomLines.forEach(l => {
            if (!linesByBom[l.bom_id[0]]) linesByBom[l.bom_id[0]] = [];
            linesByBom[l.bom_id[0]].push(l);
        });
        this.state.mfgBomStock = boms.map(b => {
            const lines = linesByBom[b.id] || [];
            const componentStatus = lines.map(l => {
                const avail = stockMap[l.product_id[0]] || 0;
                const needed = l.product_qty;
                return { name: l.product_id[1], needed, available: avail, uom: l.product_uom_id ? l.product_uom_id[1] : "", ok: avail >= needed, canMake: needed > 0 ? Math.floor(avail / needed) : 0 };
            });
            const canProduce = componentStatus.length ? Math.min(...componentStatus.map(c => c.canMake)) : 0;
            const allOk = componentStatus.every(c => c.ok);
            return { bomId: b.id, product: b.product_tmpl_id ? b.product_tmpl_id[1] : "—", bomQty: b.product_qty, uom: b.product_uom_id ? b.product_uom_id[1] : "", components: componentStatus, canProduce, allOk, status: allOk ? "ready" : canProduce > 0 ? "partial" : "blocked" };
        });
    }

    async _loadComponentShortages() {
        try {
            const moDomain = [["state", "in", ["confirmed", "progress"]]];
            if (this.state.mfgDateFrom) moDomain.push(["date_start", ">=", this.state.mfgDateFrom]);
            if (this.state.mfgDateTo)   moDomain.push(["date_start", "<=", this.state.mfgDateTo + " 23:59:59"]);
            const filteredMOs = await rpc("/web/dataset/call_kw", {
                model: "mrp.production", method: "search_read",
                args: [moDomain],
                kwargs: { fields: ["id"], limit: 200 },
            });
            if (!filteredMOs.length) { this.state.mfgShortages = []; return; }
            const moIds = filteredMOs.map(m => m.id);
            const moves = await rpc("/web/dataset/call_kw", {
                model: "stock.move", method: "search_read",
                args: [[["raw_material_production_id", "in", moIds], ["state", "not in", ["done", "cancel"]]]],
                kwargs: { fields: ["product_id", "product_uom_qty", "quantity", "raw_material_production_id", "product_uom"], limit: 200 },
            });
            this.state.mfgShortages = moves
                .filter(m => (m.quantity || 0) < m.product_uom_qty)
                .map(m => {
                    const reserved = m.quantity || 0;
                    const needed   = m.product_uom_qty;
                    const missing  = needed - reserved;
                    return {
                        moName:    m.raw_material_production_id ? m.raw_material_production_id[1] : "—",
                        moId:      m.raw_material_production_id ? m.raw_material_production_id[0] : null,
                        component: m.product_id[1],
                        needed, reserved,
                        missing:   missing.toFixed(2),
                        uom:       m.product_uom ? m.product_uom[1] : "",
                        severity:  missing > 50 ? "high" : missing > 10 ? "medium" : "low",
                    };
                })
                .sort((a, b) => parseFloat(b.missing) - parseFloat(a.missing))
                .slice(0, 40);
        } catch(e) { console.warn("_loadComponentShortages failed", e); this.state.mfgShortages = []; }
    }

    openMfgOrder(id) { window.open(`/web#model=mrp.production&id=${id}&view_type=form`, "_blank"); }

    get mfgOrdersByState() {
        const o = this.state.mfgOrders;
        return {
            draft:     o.filter(m => m.state === "draft").length,
            confirmed: o.filter(m => m.state === "confirmed").length,
            progress:  o.filter(m => m.state === "progress").length,
            done:      o.filter(m => m.state === "done").length,
            late:      o.filter(m => m.isLate).length,
        };
    }
    get mfgBomReady()       { return this.state.mfgBomStock.filter(b => b.status === "ready").length; }
    get mfgBomPartial()     { return this.state.mfgBomStock.filter(b => b.status === "partial").length; }
    get mfgBomBlocked()     { return this.state.mfgBomStock.filter(b => b.status === "blocked").length; }
    get mfgTotalShortages() { return this.state.mfgShortages.length; }

    // ── XLSX Export ───────────────────────────────────────────────────────────
    _downloadXlsx(sheetData, sheetName, fileName) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws["!cols"] = sheetData[0].map((_, ci) => ({ wch: Math.min(40, Math.max(10, ...sheetData.map(row => String(row[ci] ?? "").length))) }));
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, fileName);
    }
    downloadChartData() {
        const fromLabel = this.state.chartDateFrom || "All time"; const toLabel = this.state.chartDateTo || "Today";
        this._downloadXlsx([["Product Name", `Qty Sold (${fromLabel} → ${toLabel})`], ...this.state.topProducts.map(p => [p.name, p.qty])], "Demand Chart", "demand_chart.xlsx");
    }
    downloadSuggestions() {
        this._downloadXlsx([["Product", "Sold (2M)", "Avg/Month", "Stock", "Suggest", "UOM", "Vendor", "Draft PO", "Status"], ...this.state.suggestions.map(s => { const po = this.state.productPoMap[s.productId]; return [s.productName, s.soldLast2Months, s.monthlyAvgDemand, s.currentStock, s.suggestQty, s.uom, s.vendorName, po ? po.poName : "No PO", s.status === "critical" ? "Out of Stock" : "Low Stock"]; })], "Purchase Suggestions", "purchase_suggestions.xlsx");
    }
    downloadDeadStock() {
        this._downloadXlsx([["Product", "Category", "Stock Qty", "UOM", "Sale Price", "Cost Price", "Stock Value", "Severity"], ...this.state.deadStock.map(d => [d.productName, d.category, d.stock, d.uom, d.salePrice, d.costPrice, d.stockValue, d.severity.charAt(0).toUpperCase() + d.severity.slice(1)])], "Dead Stock", "dead_stock.xlsx");
    }
    downloadSeasonalData() {
        this._downloadXlsx([["Product", "Curr Sales", "LY Same", "LY Next", "LY After", "SI", "Projected", "Stock", "Suggest", "UOM", "Outlier?", "Reason", "Status"], ...this.state.seasonalData.map(s => [s.productName, s.currentSales, s.lyCurrentSales, s.lyNextSales, s.lyAfterNextSales, s.seasonalIndex, s.projectedDemand, s.currentStock, s.suggestOrder, s.uom, s.isOutlier ? "Yes" : "No", s.outlierReason || "—", s.status === "spike" ? "Spike Coming" : s.status === "drop" ? "Demand Drop" : "Stable"])], "Seasonal Forecast", "seasonal_forecast.xlsx");
    }
    downloadAnalyticsData() {
        this._downloadXlsx([["Product", "Category", "Sold Qty", "UOM", "Sales (Untaxed)", "Sales Tax", "Sales Total", "Purchase Qty", "Purchase (Untaxed)", "Purchase Tax", "Purchase Total", "COGS", "Gross Profit", "Margin (%)"], ...this.state.analyticsData.map(r => [r.productName, r.category, r.soldQty, r.uom, r.salesUntaxed, r.salesTax, r.salesTotal, r.purchaseQty, r.purchaseUntaxed, r.purchaseTax, r.purchaseTotal, r.cogs, r.grossProfit, r.grossMargin])], "Product Analytics", "product_analytics.xlsx");
    }
    downloadMfgOrders() {
        this._downloadXlsx([["Reference", "Product", "Qty", "UOM", "Planned Start", "Planned End", "Status", "Overdue"], ...this.state.mfgOrders.map(m => [m.name, m.product, m.qty, m.uom, m.dateStart, m.dateEnd, m.stateLabel, m.isLate ? "Yes" : "No"])], "Manufacturing Orders", "manufacturing_orders.xlsx");
    }
    downloadShortages() {
        this._downloadXlsx([["Manufacturing Order", "Component", "Needed", "Reserved", "Missing", "UOM", "Severity"], ...this.state.mfgShortages.map(s => [s.moName, s.component, s.needed, s.reserved, s.missing, s.uom, s.severity.charAt(0).toUpperCase() + s.severity.slice(1)])], "Component Shortages", "component_shortages.xlsx");
    }

    // ── Chart render ──────────────────────────────────────────────────────────
    _renderChart() {
        if (!this.chartRef.el || !this.state.topProducts.length) return;
        const existing = Chart.getChart(this.chartRef.el);
        if (existing) existing.destroy();
        const colors = ["#4F81BD","#C0504D","#9BBB59","#8064A2","#4BACC6","#F79646","#2C7BB6","#D7191C","#1A9641","#FDAE61","#ABD9E9","#A6D96A"];
        const type = this.state.chartType;
        const fromLabel = this.state.chartDateFrom || "All time"; const toLabel = this.state.chartDateTo || "Today";
        const label = `Top ${this.state.chartTopN} Products (${fromLabel} → ${toLabel})`;
        new Chart(this.chartRef.el, {
            type,
            data: {
                labels: this.state.topProducts.map(p => p.name),
                datasets: [{ label: "Qty Sold", data: this.state.topProducts.map(p => p.qty), backgroundColor: type === "bar" ? colors.map(c => c+"CC") : colors, borderColor: type === "bar" ? colors : "#fff", borderWidth: 2 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: type === "bar" ? "top" : "right", labels: { font: { size: 12 } } },
                    title:  { display: true, text: label, font: { size: 15, weight: "bold" } },
                    tooltip: { callbacks: { label: (ctx) => { const val = type === "bar" ? ctx.parsed.y : ctx.parsed; return ` ${ctx.label}: ${val.toLocaleString()} units`; } } },
                },
                ...(type === "bar" ? { scales: { y: { beginAtZero: true, ticks: { font: { size: 11 } } } } } : {}),
            },
        });
    }

    setTab(tab) { this.state.activeTab = tab; if (tab === "chart") setTimeout(() => this._renderChart(), 50); }
    _nMonthsAgo(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().split("T")[0]; }
}

InventoryForecastDashboard.template = "InventoryForecastDashboard";
registry.category("actions").add("inventory_forecast_dashboard", InventoryForecastDashboard);