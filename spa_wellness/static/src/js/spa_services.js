/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class SpaServices extends Component {
    static template = "spa_wellness.SpaServices";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            services: [],
            loading: true,
            selectedIds: new Set(),
        });

        onWillStart(async () => {
            await this.loadServices();
        });
    }

    // ───────────────────────────────
    // LOAD SERVICES
    // ───────────────────────────────
    async loadServices() {
        this.state.loading = true;

        const services = await this.orm.searchRead(
            "spa.service",
            [["active", "=", true]],
            [
                "id",
                "name",
                "category_id",
                "duration",
                "service_charge",
                "price",
                "room_type",
                "is_commission",
            ],
            { order: "name asc" }
        );

        this.state.services = services.map(s => ({
            ...s,
            categoryName: s.category_id ? s.category_id[1] : "",
        }));

        this.state.loading = false;
    }

    // ───────────────────────────────
    // TOGGLE SELECTION
    // ───────────────────────────────
    toggleSelect(serviceId, event) {
        event.stopPropagation();

        const ids = new Set(this.state.selectedIds);
        if (ids.has(serviceId)) {
            ids.delete(serviceId);
        } else {
            ids.add(serviceId);
        }
        this.state.selectedIds = ids;
    }

    openBookingPanel() {
        this.action.doAction("spa_wellness.action_spa_booking_panel");
    }

    isSelected(serviceId) {
        return this.state.selectedIds.has(serviceId);
    }

    get selectedCount() {
        return this.state.selectedIds.size;
    }

    // ───────────────────────────────
    // CREATE APPOINTMENT
    // ───────────────────────────────
    async createAppointment() {
        if (this.state.selectedIds.size === 0) return;

        const serviceLines = [...this.state.selectedIds].map(id => [0, 0, { service_id: id }]);

        const ids = await this.orm.create("spa.appointment", [
            { service_line_ids: serviceLines }
        ]);
        const appointmentId = ids[0];

        // Trigger onchange for each service line so consumable products populate
        await this.orm.call(
            "spa.appointment",
            "recompute_consumable_lines",
            [appointmentId]
        );

        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "spa.appointment",
            res_id: appointmentId,
            views: [[false, "form"]],
            view_mode: "form",
            target: "current",
        });
    }

    // ───────────────────────────────
    // OPEN SERVICE FORM (single)
    // ───────────────────────────────
    openService(serviceId) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "spa.service",
            res_id: serviceId,
            views: [[false, "form"]],
            view_mode: "form",
            target: "current",
        });
    }

    // BACK TO DASHBOARD
    goBack() {
        this.action.doAction("spa_wellness.action_spa_dashboard");
    }
}

registry.category("actions").add(
    "spa_wellness.spa_services",
    SpaServices
);