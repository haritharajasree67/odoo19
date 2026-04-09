/** @odoo-module **/

import { Component, onWillStart, onMounted, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

export class SpaAppointmentCards extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");
        const today = new Date();
        const pad = n => String(n).padStart(2, "0");
        const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;

        this.state = useState({
            appointments: [],
            search: "",
            selectedDate: todayStr,
        });

        onWillStart(async () => {
            await this.loadAppointments();
        });

        onMounted(() => {
            document.body.classList.add("spa-cards-open");
        });

        onWillUnmount(() => {
            document.body.classList.remove("spa-cards-open");
        });
    }

    getDateDomain() {
        const ymd = this.state.selectedDate;
        return [
            ["start_datetime", ">=", `${ymd} 00:00:00`],
            ["start_datetime", "<=", `${ymd} 23:59:59`],
        ];
    }

    async loadAppointments() {
        let domain = this.getDateDomain();

        if (this.state.search.trim()) {
            const q = this.state.search.trim();
            // Search by customer name OR phone number on the partner
            domain.push("|",
                ["partner_id.name",  "ilike", q],
                ["partner_id.phone", "ilike", q],
            );
        }

        this.state.appointments = await this.orm.searchRead(
            "spa.appointment",
            domain,
            ["name", "partner_id", "start_datetime", "state",
             "therapist_id", "room_id", "total_price"],
            { order: "start_datetime asc" }
        );
    }

    openBookingPanel() {
        this.action.doAction("spa_wellness.action_spa_booking_panel");
    }

    openAppointment(apptId) {
        this.action.doAction({
            type:      "ir.actions.act_window",
            res_model: "spa.appointment",
            res_id:    apptId,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    async onDateChange(ev) {
        this.state.selectedDate = ev.target.value;
        await this.loadAppointments();
    }

    async onSearch(ev) {
        this.state.search = ev.target.value;
        await this.loadAppointments();
    }

    formatTime(dtStr) {
        if (!dtStr) return "—";
        return new Date(dtStr).toLocaleTimeString("en-US",
            { hour: "2-digit", minute: "2-digit" });
    }

    close() { this.action.doAction("spa_wellness.dashboard"); }
}

SpaAppointmentCards.template = "spa.SpaAppointmentCards";

registry.category("actions").add("spa_appointment_cards", SpaAppointmentCards);