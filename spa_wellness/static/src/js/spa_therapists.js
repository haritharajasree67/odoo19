/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class SpaTherapists extends Component {
    static template = "spa_wellness.SpaTherapists";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            therapists: [],
            loading: true,
        });

        onWillStart(async () => {
            await this.loadTherapists();
        });
    }

    // ─────────────────────────────
    // LOAD THERAPISTS
    // ─────────────────────────────
    async loadTherapists() {
        this.state.loading = true;

        this.state.therapists = await this.orm.searchRead(
            "spa.therapist",
            [["active", "=", true]],
            ["id", "name", "mobile", "email", "image"],
            { order: "name asc" }
        );

        this.state.loading = false;
    }

    // ─────────────────────────────
    // OPEN SLOT CHECKER
    // ─────────────────────────────
    openAvailability(therapist) {
        this.action.doAction({
            type: "ir.actions.client",
            tag: "spa_wellness.slot_checker",
            name: "Therapist Availability",
            context: {
                default_therapist_id: therapist.id,
                default_therapist_name: therapist.name,
            },
        });
    }
    openBookingPanel() {
        this.action.doAction("spa_wellness.action_spa_booking_panel");
    }

    goBack() {
        this.action.doAction("spa_wellness.action_spa_dashboard");
    }
}

registry.category("actions").add(
    "spa_wellness.spa_therapists",
    SpaTherapists
);