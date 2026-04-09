/** @odoo-module **/

import { registry }                          from "@web/core/registry";
import { Component, useState, onWillStart,
         onMounted, onWillUnmount }          from "@odoo/owl";
import { useService }                        from "@web/core/utils/hooks";

class SpaDashboard extends Component {
    static template = "spa_wellness.Dashboard";

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        this.state = useState({
            bookingCount:        0,
            upcomingCount:       0,
            availableTherapists: 0,
            todayRevenue:        0,
            loading:             true,
            currentTime:         "",
            currentDate:         "",
        });

        onWillStart(async () => {
            this._updateClock();
            await this.loadStats();
        });

        onMounted(() => {
            this._clockInterval = setInterval(() => this._updateClock(), 1000);
            // Hide the secondary app menu (Appointments, Packages, Report, Config)
            // while the dashboard is active. Restored automatically on navigate-away.
            document.body.classList.add("spa-dashboard-active");
        });

        onWillUnmount(() => {
            clearInterval(this._clockInterval);
            document.body.classList.remove("spa-dashboard-active");
        });
    }

    _updateClock() {
        const now = new Date();
        this.state.currentTime = now.toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", hour12: true,
        });
        this.state.currentDate = now.toLocaleDateString("en-GB", {
            weekday: "long", day: "numeric", month: "long", year: "numeric",
        });
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    _fmt(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} ` +
               `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _todayRange() {
        const now   = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(),  0,  0,  0);
        const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return { start: this._fmt(start), end: this._fmt(end) };
    }

    _nowStr() { return this._fmt(new Date()); }

    async loadStats() {
        const { start, end } = this._todayRange();
        const now = this._nowStr();

        try {
            const [bookingCount, upcomingCount, busyRaw, totalTherapists, prices] =
                await Promise.all([
                    this.orm.searchCount("spa.appointment", [
                        ["start_datetime", ">=", start],
                        ["start_datetime", "<=", end],
                        ["state", "not in", ["cancelled", "no_show"]],
                    ]),
                    this.orm.searchCount("spa.appointment", [
                        ["start_datetime", ">=", now],
                        ["start_datetime", "<=", end],
                        ["state", "not in", ["cancelled", "no_show"]],
                    ]),
                    this.orm.searchRead("spa.appointment", [
                        ["start_datetime", "<=", now],
                        ["end_datetime",   ">=", now],
                        ["state", "in",  ["confirmed", "in_progress"]],
                        ["therapist_id",  "!=", false],
                    ], ["therapist_id"], { limit: 200 }),
                    this.orm.searchCount("spa.therapist", [["active", "=", true]]),
                    this.orm.searchRead("spa.appointment", [
                        ["start_datetime", ">=", start],
                        ["start_datetime", "<=", end],
                        ["state", "not in", ["cancelled", "no_show"]],
                    ], ["total_price"], { limit: 500 }),
                ]);

            const busyIds = [...new Set(busyRaw.map(a => a.therapist_id[0]))];
            this.state.bookingCount        = bookingCount;
            this.state.upcomingCount       = upcomingCount;
            this.state.availableTherapists = Math.max(totalTherapists - busyIds.length, 0);
            this.state.todayRevenue        = prices.reduce((s, a) => s + (a.total_price || 0), 0);
        } catch (e) {
            console.warn("[SpaDashboard] loadStats error:", e);
        }
        this.state.loading = false;
    }

    formatRevenue(v) { return (v || 0).toFixed(3) + " BD"; }

    openBookings() {
        this.action.doAction({ type: "ir.actions.client", tag: "spa_appointment_cards" });
    }

    openMore() {
        this.action.doAction("spa_wellness.action_spa_appointment");
    }

    openNewBooking() {
        this.action.doAction("spa_wellness.action_spa_booking_panel");
    }
}

registry.category("actions").add("spa_wellness.dashboard", SpaDashboard);