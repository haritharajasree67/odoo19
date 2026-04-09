/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class SpaRooms extends Component {
    static template = "spa_wellness.SpaRooms";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            rooms: [],
            loading: true,
        });

        onWillStart(async () => {
            await this.loadRooms();
        });
    }

    // ───────────────────────────────
    // LOAD ROOMS
    // ───────────────────────────────
    async loadRooms() {
        this.state.loading = true;

        const rooms = await this.orm.searchRead(
            "spa.room",
            [["active", "=", true]],
            [
                "id",
                "name",
                "code",
                "room_type",
                "capacity",
                "status",
                "branch_id",
                "notes",
                "color",
            ],
            { order: "name asc" }
        );

        this.state.rooms = rooms.map(r => ({
            ...r,
            branchName: r.branch_id ? r.branch_id[1] : "",
        }));

        this.state.loading = false;
    }

    // ───────────────────────────────
    // OPEN ROOM FORM
    // ───────────────────────────────
    openRoom(roomId) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "spa.room",
            res_id: roomId,
            view_mode: "form",
            views: [[false, "form"]],
            target: "current",
        });
    }

    openBookingPanel() {
        this.action.doAction("spa_wellness.action_spa_booking_panel");
    }

    openAvailability(room) {
    this.action.doAction({
        type: "ir.actions.client",
        tag: "spa_wellness.slot_checker",
        name: "Room Availability",
        context: {
            default_room_id: room.id,
            default_room_name: room.name,
        },
    });
}

    // ───────────────────────────────
    // BACK
    // ───────────────────────────────
    goBack() {
        this.action.doAction("spa_wellness.action_spa_dashboard");
    }
}

registry.category("actions").add(
    "spa_wellness.spa_rooms",
    SpaRooms
);