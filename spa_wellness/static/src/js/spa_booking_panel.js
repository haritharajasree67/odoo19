/** @odoo-module **/
import { registry }                                        from "@web/core/registry";
import { Component, useState, onWillStart, onMounted,
         onWillUnmount }                                   from "@odoo/owl";
import { useService }                                      from "@web/core/utils/hooks";

export class SpaBookingPanel extends Component {
    static template = "spa_wellness.BookingPanel";

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        this.state = useState({
            viewMode:         "services",   // "services" | "packages" | "therapists"

            categories:       [],
            services:         [],
            activeCategory:   null,
            searchQuery:      "",

            packages:         [],
            packageSearch:    "",

            // ── therapist-browse state ──────────────────────────
            therapistSearch:      "",
            // Date/time used in the therapist-browse tab for live availability preview
            browseDate:           "",
            browseTime:           "09:00",
            browseCheckDone:      false,   // true once first availability check ran
            browseBusyRoomIds:    [],
            browseBusyTherapistIds: [],
            // Therapist chosen from the browse tab (pre-fills slot modal)
            preselectedTherapistId: null,

            // cart: [{id, name, price, qty, itemType, duration?}]
            cart:             [],

            partnerId:        null,
            partnerName:      "",
            partnerSearch:    "",
            partnerResults:   [],

            // ── new customer inline form ──────────────────────────
            showNewCustomer:  false,
            newCustName:      "",
            newCustPhone:     "",
            newCustEmail:     "",
            newCustSaving:    false,
            newCustError:     "",

            // ── slot modal ────────────────────────────────────────
            showSlotModal:    false,
            slotDate:         "",
            slotTime:         "09:00",
            allRooms:         [],
            allTherapists:    [],
            busyRoomIds:      [],
            busyTherapistIds: [],
            selectedRoomId:   null,
            selectedTherapistId: null,
            slotsLoading:     false,

            // ── confirm modal ─────────────────────────────────────
            showConfirmModal: false,

            loading:          true,
            saving:           false,
        });

        onWillStart(async () => {
            const today = new Date();
            const todayStr = today.toISOString().split("T")[0];
            this.state.slotDate  = todayStr;
            this.state.browseDate = todayStr;
            await Promise.all([
                this.loadCategoriesAndServices(),
                this.loadPackages(),
                this.loadAllRoomsAndTherapists(),
            ]);
            // Run initial availability check for therapist browse tab
            await this.runBrowseAvailabilityCheck();
            this.state.loading = false;
        });

        onMounted(() => { document.body.classList.add("spa-booking-open"); });
        onWillUnmount(() => { document.body.classList.remove("spa-booking-open"); });
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────

    _fmtDatetime(d) {
        const pad = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
               `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    _slotStart() {
        return new Date(`${this.state.slotDate}T${this.state.slotTime}:00`);
    }

    _browseStart() {
        return new Date(`${this.state.browseDate}T${this.state.browseTime}:00`);
    }

    // ── LOADERS ──────────────────────────────────────────────────────────────

    async loadCategoriesAndServices() {
        const [cats, svcs] = await Promise.all([
            this.orm.searchRead("spa.service.category", [], ["id","name"], { order:"name asc" }),
            this.orm.searchRead("spa.service", [["active","=",true]],
                ["id","name","category_id","price","duration"], { order:"name asc" }),
        ]);
        this.state.categories = cats;
        this.state.services   = svcs;
    }

    async loadPackages() {
        const pkgs = await this.orm.searchRead(
            "spa.package.template", [["active","=",true]],
            ["id","name","price","validity_days"], { order:"name asc" }
        );
        if (!pkgs.length) { this.state.packages = []; return; }

        const lines = await this.orm.searchRead(
            "spa.package.template.line", [["package_id","in", pkgs.map(p=>p.id)]],
            ["id","package_id","service_id","sessions"]
        );

        const lineServiceIds = [...new Set(lines.map(l => l.service_id?.[0]).filter(Boolean))];
        let lineSvcPriceMap = {};
        if (lineServiceIds.length) {
            const lineSvcs = await this.orm.searchRead(
                "spa.service", [["id","in",lineServiceIds]], ["id","price","duration"]
            );
            lineSvcs.forEach(s => { lineSvcPriceMap[s.id] = { price: s.price, duration: s.duration }; });
        }

        const byPkg = {};
        lines.forEach(l => {
            const pid  = l.package_id[0];
            const svcId = l.service_id?.[0];
            (byPkg[pid] = byPkg[pid]||[]).push({
                serviceId:   svcId,
                serviceName: l.service_id?.[1] || "—",
                sessions:    l.sessions || 1,
                price:       lineSvcPriceMap[svcId]?.price    || 0,
                duration:    lineSvcPriceMap[svcId]?.duration || 60,
            });
        });
        this.state.packages = pkgs.map(p => ({ ...p, lines: byPkg[p.id]||[] }));
    }

    async loadAllRoomsAndTherapists() {
        const [rooms, therapists] = await Promise.all([
            this.orm.searchRead("spa.room", [["active","=",true]],
                ["id","name","room_type","capacity","status"], { order:"name asc" }),
            this.orm.searchRead("spa.therapist", [["active","=",true]],
                ["id","name","specialization","skill_ids"], { order:"name asc" }),
        ]);
        this.state.allRooms = rooms;

        const allSkillIds = [...new Set(therapists.flatMap(t => t.skill_ids||[]))];
        let skillMap = {};
        if (allSkillIds.length) {
            const svcs = await this.orm.searchRead("spa.service", [["id","in",allSkillIds]], ["id","name"]);
            svcs.forEach(s => { skillMap[s.id] = s.name; });
        }
        this.state.allTherapists = therapists.map(t => ({
            ...t,
            serviceNames: (t.skill_ids||[]).map(id=>skillMap[id]).filter(Boolean).join(", ") || "—",
        }));
    }

    // ── AVAILABILITY (slot modal) ─────────────────────────────────────────────

    async checkAvailability() {
        this.state.slotsLoading = true;

        const start = this._slotStart();
        const maxDur = Math.max(
            ...this.state.cart
                .filter(i => i.itemType === "service")
                .map(i => this.state.services.find(s=>s.id===i.id)?.duration || 60),
            60
        );
        const end = new Date(start.getTime() + maxDur * 60000);
        const startStr = this._fmtDatetime(start);
        const endStr   = this._fmtDatetime(end);

        const [busyRooms, busyTherapists] = await Promise.all([
            this.orm.searchRead("spa.appointment", [
                ["start_datetime","<", endStr],
                ["end_datetime",  ">", startStr],
                ["state","in",["confirmed","in_progress","draft"]],
                ["room_id","!=",false],
            ], ["room_id"], { limit:500 }),
            this.orm.searchRead("spa.appointment", [
                ["start_datetime","<", endStr],
                ["end_datetime",  ">", startStr],
                ["state","in",["confirmed","in_progress","draft"]],
                ["therapist_id","!=",false],
            ], ["therapist_id"], { limit:500 }),
        ]);

        this.state.busyRoomIds      = [...new Set(busyRooms.map(a=>a.room_id[0]))];
        this.state.busyTherapistIds = [...new Set(busyTherapists.map(a=>a.therapist_id[0]))];

        if (this.state.busyRoomIds.includes(this.state.selectedRoomId))
            this.state.selectedRoomId = null;
        if (this.state.busyTherapistIds.includes(this.state.selectedTherapistId))
            this.state.selectedTherapistId = null;

        this.state.slotsLoading = false;
    }

    // ── AVAILABILITY (therapist-browse tab) ───────────────────────────────────

    async runBrowseAvailabilityCheck() {
        const start = this._browseStart();
        // Use 60 min as the window for browse-tab checks
        const end = new Date(start.getTime() + 60 * 60000);
        const startStr = this._fmtDatetime(start);
        const endStr   = this._fmtDatetime(end);

        const busyTherapists = await this.orm.searchRead("spa.appointment", [
            ["start_datetime","<", endStr],
            ["end_datetime",  ">", startStr],
            ["state","in",["confirmed","in_progress","draft"]],
            ["therapist_id","!=",false],
        ], ["therapist_id"], { limit:500 });

        this.state.browseBusyTherapistIds = [...new Set(busyTherapists.map(a=>a.therapist_id[0]))];
        this.state.browseCheckDone = true;
    }

    async onBrowseDateChange(ev) {
        this.state.browseDate = ev.target.value;
        await this.runBrowseAvailabilityCheck();
    }

    async onBrowseTimeChange(ev) {
        this.state.browseTime = ev.target.value;
        await this.runBrowseAvailabilityCheck();
    }

    isTherapistBusy(therapistId) {
        return this.state.browseBusyTherapistIds.includes(therapistId);
    }

    get filteredTherapists() {
        const q = this.state.therapistSearch.trim().toLowerCase();
        if (!q) return this.state.allTherapists;
        return this.state.allTherapists.filter(t =>
            t.name.toLowerCase().includes(q) ||
            (t.specialization || "").toLowerCase().includes(q) ||
            (t.serviceNames   || "").toLowerCase().includes(q)
        );
    }

    get browseAvailableTherapists() {
        return this.filteredTherapists.filter(t => !this.isTherapistBusy(t.id));
    }

    get browseUnavailableTherapists() {
        return this.filteredTherapists.filter(t => this.isTherapistBusy(t.id));
    }

    /**
     * Step 1 of therapist-first flow.
     * Store the chosen therapist + the browse date/time, then send the user
     * to the Services tab so they can pick what they want.
     * The slot modal (Step 2) is opened by the normal "Book Appointment →" button
     * in the cart footer, at which point the therapist is already pre-filled.
     */
    selectTherapistThenServices(therapist) {
        this.state.preselectedTherapistId = therapist.id;
        // Carry the browse date/time into the slot modal when it opens
        this.state.slotDate = this.state.browseDate;
        this.state.slotTime = this.state.browseTime;
        // Switch to services tab so user can now add services
        this.state.viewMode      = "services";
        this.state.activeCategory = null;
        this.state.searchQuery    = "";
    }

    /** Clear the pre-selected therapist (user clicked ✕ in the right pane banner). */
    clearPreselectedTherapist() {
        this.state.preselectedTherapistId = null;
    }

    get preselectedTherapist() {
        return this.state.allTherapists.find(t => t.id === this.state.preselectedTherapistId) || null;
    }

    onTherapistSearchInput(ev) { this.state.therapistSearch = ev.target.value; }

    isRoomAvailable(room) {
        return room.status !== "maintenance" && !this.state.busyRoomIds.includes(room.id);
    }
    isTherapistAvailable(th) {
        return !this.state.busyTherapistIds.includes(th.id);
    }

    get availableRooms()       { return this.state.allRooms.filter(r => this.isRoomAvailable(r)); }
    get unavailableRooms()     { return this.state.allRooms.filter(r => !this.isRoomAvailable(r)); }
    get availableTherapists()  { return this.state.allTherapists.filter(t => this.isTherapistAvailable(t)); }
    get unavailableTherapists(){ return this.state.allTherapists.filter(t => !this.isTherapistAvailable(t)); }

    get selectedRoom()       { return this.state.allRooms.find(r => r.id === this.state.selectedRoomId); }
    get selectedTherapist()  { return this.state.allTherapists.find(t => t.id === this.state.selectedTherapistId); }

    // ── MODAL CONTROL ─────────────────────────────────────────────────────────

    async openSlotModal() {
        if (this.cartIsEmpty) return;
        this.state.selectedRoomId      = null;
        // Carry forward therapist chosen in browse tab (if any)
        this.state.selectedTherapistId = this.state.preselectedTherapistId || null;
        this.state.showConfirmModal    = false;
        this.state.showSlotModal       = true;
        await this.checkAvailability();
        // Re-apply after availability check in case it was cleared
        if (this.state.preselectedTherapistId &&
            !this.state.busyTherapistIds.includes(this.state.preselectedTherapistId)) {
            this.state.selectedTherapistId = this.state.preselectedTherapistId;
        }
    }

    closeSlotModal() {
        this.state.showSlotModal    = false;
        this.state.showConfirmModal = false;
        // Do NOT clear preselectedTherapistId here — user may re-open the modal
    }

    async onSlotDateChange(ev) {
        this.state.slotDate = ev.target.value;
        const prevTherapistId = this.state.selectedTherapistId;
        await this.checkAvailability();
        // Re-apply preselected therapist if it's still available
        if (prevTherapistId && !this.state.busyTherapistIds.includes(prevTherapistId)) {
            this.state.selectedTherapistId = prevTherapistId;
        }
    }

    async onSlotTimeChange(ev) {
        this.state.slotTime = ev.target.value;
        const prevTherapistId = this.state.selectedTherapistId;
        await this.checkAvailability();
        if (prevTherapistId && !this.state.busyTherapistIds.includes(prevTherapistId)) {
            this.state.selectedTherapistId = prevTherapistId;
        }
    }

    selectRoom(id) {
        this.state.selectedRoomId = this.state.selectedRoomId === id ? null : id;
    }

    selectTherapist(id) {
        this.state.selectedTherapistId = this.state.selectedTherapistId === id ? null : id;
    }

    confirmSlotSelection() {
        this.state.showSlotModal    = false;
        this.state.showConfirmModal = true;
    }

    backToSlotModal() {
        this.state.showConfirmModal = false;
        this.state.showSlotModal    = true;
    }

    // ── COMPUTED ─────────────────────────────────────────────────────────────

    get filteredServices() {
        let list = this.state.services;
        if (this.state.activeCategory)
            list = list.filter(s => s.category_id?.[0] === this.state.activeCategory);
        if (this.state.searchQuery.trim()) {
            const q = this.state.searchQuery.toLowerCase();
            list = list.filter(s => s.name.toLowerCase().includes(q));
        }
        return list;
    }

    get filteredPackages() {
        const q = this.state.packageSearch.trim().toLowerCase();
        return q ? this.state.packages.filter(p=>p.name.toLowerCase().includes(q))
                 : this.state.packages;
    }

    get cartTotal() {
        return this.state.cart.reduce((s,i) => s + (i.price||0)*i.qty, 0);
    }

    get cartIsEmpty() { return this.state.cart.length === 0; }

    get hasPackageInCart() {
        return this.state.cart.some(i => i.itemType === "package");
    }

    cartQty(id, type) {
        return this.state.cart.find(i=>i.id===id&&i.itemType===type)?.qty || 0;
    }

    formatCurrency(amount) { return (amount||0).toFixed(3) + " BD"; }

    formatSlotDisplay() {
        if (!this.state.slotDate) return "—";
        const d = new Date(`${this.state.slotDate}T${this.state.slotTime}:00`);
        return d.toLocaleString("en-GB", {
            weekday:"short", day:"2-digit", month:"short", year:"numeric",
            hour:"2-digit", minute:"2-digit",
        });
    }

    formatBrowseDateDisplay() {
        if (!this.state.browseDate) return "—";
        const d = new Date(`${this.state.browseDate}T${this.state.browseTime}:00`);
        return d.toLocaleString("en-GB", {
            weekday:"short", day:"2-digit", month:"short",
            hour:"2-digit", minute:"2-digit",
        });
    }

    roomTypeLabel(type) {
        return { single:"Single", couple:"Couple", group:"Group", vip:"VIP" }[type] || type;
    }

    // ── VIEW / CATEGORY / SEARCH ──────────────────────────────────────────────

    setViewMode(mode) {
        this.state.viewMode       = mode;
        this.state.activeCategory = null;
        this.state.searchQuery    = "";
        this.state.packageSearch  = "";
        this.state.therapistSearch = "";
    }

    selectCategory(catId) {
        this.state.activeCategory = this.state.activeCategory === catId ? null : catId;
    }

    onSearchInput(ev)          { this.state.searchQuery    = ev.target.value; }
    onPackageSearchInput(ev)   { this.state.packageSearch  = ev.target.value; }

    // ── CART ─────────────────────────────────────────────────────────────────

    addService(svc)      { this._cartAdd(svc.id, svc.name, svc.price, "service"); }
    decreaseService(svc) { this._cartDecrease(svc.id, "service"); }
    addPackage(pkg) {
        const existingIdx = this.state.cart.findIndex(i => i.itemType === "package");
        if (existingIdx >= 0) {
            if (this.state.cart[existingIdx].id === pkg.id) return;
            this.state.cart.splice(existingIdx, 1);
        }
        this.state.cart.push({ id: pkg.id, name: pkg.name, price: pkg.price || 0, qty: 1, itemType: "package" });
    }
    decreasePackage(pkg) { this._cartDecrease(pkg.id, "package"); }

    _cartAdd(id, name, price, itemType) {
        const idx = this.state.cart.findIndex(i=>i.id===id&&i.itemType===itemType);
        idx >= 0 ? this.state.cart[idx].qty++
                 : this.state.cart.push({ id, name, price:price||0, qty:1, itemType });
    }

    _cartDecrease(id, itemType) {
        const idx = this.state.cart.findIndex(i=>i.id===id&&i.itemType===itemType);
        if (idx >= 0) {
            this.state.cart[idx].qty--;
            if (this.state.cart[idx].qty <= 0) this.state.cart.splice(idx, 1);
        }
    }

    removeCartItem(item) {
        const idx = this.state.cart.findIndex(i=>i.id===item.id&&i.itemType===item.itemType);
        if (idx >= 0) this.state.cart.splice(idx, 1);
    }

    clearCart() {
        this.state.cart = [];
        this.state.preselectedTherapistId = null;
    }

    // ── PARTNER ───────────────────────────────────────────────────────────────

    async onPartnerInput(ev) {
        this.state.partnerSearch    = ev.target.value;
        this.state.showNewCustomer  = false;
        this.state.newCustError     = "";

        if (this.state.partnerSearch.length < 2) {
            this.state.partnerResults = [];
            return;
        }
        this.state.partnerResults = await this.orm.searchRead(
            "res.partner", [["name","ilike",this.state.partnerSearch]],
            ["id","name","phone"], { limit:8 }
        );
    }

    selectPartner(p) {
        this.state.partnerId       = p.id;
        this.state.partnerName     = p.name;
        this.state.partnerSearch   = p.name;
        this.state.partnerResults  = [];
        this.state.showNewCustomer = false;
    }

    clearPartner() {
        this.state.partnerId       = null;
        this.state.partnerName     = "";
        this.state.partnerSearch   = "";
        this.state.partnerResults  = [];
        this.state.showNewCustomer = false;
    }

    // ── NEW CUSTOMER FORM ─────────────────────────────────────────────────────

    openNewCustomerForm() {
        this.state.newCustName     = this.state.partnerSearch;
        this.state.newCustPhone    = "";
        this.state.newCustEmail    = "";
        this.state.newCustError    = "";
        this.state.partnerResults  = [];
        this.state.showNewCustomer = true;
    }

    closeNewCustomerForm() {
        this.state.showNewCustomer = false;
        this.state.newCustError    = "";
    }

    onNewCustName(ev)  { this.state.newCustName  = ev.target.value; }
    onNewCustPhone(ev) { this.state.newCustPhone = ev.target.value; }
    onNewCustEmail(ev) { this.state.newCustEmail = ev.target.value; }

    async saveNewCustomer() {
        if (!this.state.newCustName.trim()) {
            this.state.newCustError = "Name is required.";
            return;
        }
        this.state.newCustSaving = true;
        this.state.newCustError  = "";

        try {
            const vals = { name: this.state.newCustName.trim() };
            if (this.state.newCustPhone.trim()) vals.phone = this.state.newCustPhone.trim();
            if (this.state.newCustEmail.trim()) vals.email = this.state.newCustEmail.trim();

            const result = await this.orm.create("res.partner", [vals]);
            const newId  = Array.isArray(result) ? result[0] : result;

            this.state.partnerId       = newId;
            this.state.partnerName     = vals.name;
            this.state.partnerSearch   = vals.name;
            this.state.showNewCustomer = false;
            this.state.newCustSaving   = false;
        } catch(e) {
            this.state.newCustError  = "Failed to create customer. Please try again.";
            this.state.newCustSaving = false;
            console.error("Create partner failed:", e);
        }
    }

    // ── CREATE APPOINTMENT ───────────────────────────────────────────────────

    async createAppointment() {
        if (this.cartIsEmpty) return;
        this.state.saving = true;
        this.state.showConfirmModal = false;

        try {
            const start        = this._slotStart();
            const serviceItems = this.state.cart.filter(i => i.itemType === "service");
            const packageItem  = this.state.cart.find(i => i.itemType === "package") || null;

            const serviceLines = [];
            let totalDuration  = 0;
            let totalPrice     = 0;

            for (const item of serviceItems) {
                const svc = this.state.services.find(s => s.id === item.id);
                const dur = svc?.duration || 60;
                for (let q = 0; q < item.qty; q++) {
                    serviceLines.push([0, 0, {
                        service_id:     item.id,
                        service_charge: item.price || 0,
                    }]);
                    totalDuration += dur;
                    totalPrice    += item.price || 0;
                }
            }

            if (packageItem) {
                const fullPkg = this.state.packages.find(p => p.id === packageItem.id);
                if (fullPkg && fullPkg.lines.length > 0) {
                    for (const line of fullPkg.lines) {
                        if (!line.serviceId) continue;
                        const sessionCount = line.sessions || 1;
                        for (let s = 0; s < sessionCount; s++) {
                            serviceLines.push([0, 0, {
                                service_id:     line.serviceId,
                                service_charge: line.price || 0,
                            }]);
                            totalDuration += line.duration || 60;
                            totalPrice    += line.price    || 0;
                        }
                    }
                } else {
                    totalPrice += (packageItem.price || 0) * packageItem.qty;
                }
            }

            if (totalDuration === 0) totalDuration = 60;

            const end = new Date(start.getTime() + totalDuration * 60000);

            const vals = {
                start_datetime: this._fmtDatetime(start),
                end_datetime:   this._fmtDatetime(end),
                duration:       totalDuration,
                price:          totalPrice,
                state:          "confirmed",
            };

            if (serviceLines.length > 0) vals.service_line_ids = serviceLines;
            if (packageItem)             vals.package_id        = packageItem.id;
            if (this.state.partnerId)           vals.partner_id   = this.state.partnerId;
            if (this.state.selectedRoomId)      vals.room_id      = this.state.selectedRoomId;
            if (this.state.selectedTherapistId) vals.therapist_id = this.state.selectedTherapistId;

            const result = await this.orm.create("spa.appointment", [vals]);
            const newId  = Array.isArray(result) ? result[0] : result;

            try {
                await this.orm.call("spa.appointment", "recompute_consumable_lines", [[newId]]);
            } catch(e) { console.warn("recompute_consumable_lines failed:", e); }

            this.state.cart   = [];
            this.state.saving = false;

            this.action.doAction("spa_wellness.action_spa_appointment_cards");

        } catch(e) {
            console.error("Create appointment failed:", e);
            this.state.saving = false;
        }
    }

    close() { this.action.doAction("spa_wellness.dashboard"); }
}

registry.category("actions").add("booking_panel", SpaBookingPanel);