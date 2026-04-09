/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class SpaSlotChecker extends Component {
    static template = "spa_wellness.SlotChecker";

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const ctx = this.props.action?.context || {};


        this.state = useState({
            slots:           [],
            allTherapists:   [],
            allRooms:        [],
            slotDate:        this._todayStr(),
            slotDuration:    "60",
            slotTherapistId: ctx.default_therapist_id
            ? String(ctx.default_therapist_id)
            : "",
             slotRoomId: ctx.default_room_id
            ? String(ctx.default_room_id)
            : "",

            loading:         false,
        });

        onWillStart(async () => {
            await this._loadDropdowns();
            await this.loadSlots();
        });
    }

    // ── HELPERS ──────────────────────────────────────────────────

    _todayStr() {
        return new Date().toISOString().split("T")[0];
    }

    _formatSlotTime(d) {
        return d.toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", hour12: true,
        });
    }

    // ── LOAD DROPDOWNS ───────────────────────────────────────────

    async _loadDropdowns() {
        const [therapists, rooms] = await Promise.all([
            this.orm.searchRead(
                "spa.therapist",
                [["active", "=", true]],
                ["id", "name"],
                { order: "name asc" }
            ),
            this.orm.searchRead(
                "spa.room",
                [["active", "=", true]],
                ["id", "name", "status"],
                { order: "name asc" }
            ),
        ]);
        this.state.allTherapists = therapists;
        this.state.allRooms      = rooms;
    }

    // ── LOAD SLOTS ───────────────────────────────────────────────

    async loadSlots() {
        this.state.loading = true;

        const duration  = parseInt(this.state.slotDuration || "60");
        const workStart = 9;
        const workEnd   = 18;
        const slots     = [];

        const baseDate = new Date(this.state.slotDate);
        baseDate.setHours(0, 0, 0, 0);

        const fmt = (d) => d.toISOString().replace("T", " ").split(".")[0];

        let current = new Date(baseDate);
        current.setHours(workStart, 0, 0, 0);

        const dayEnd = new Date(baseDate);
        dayEnd.setHours(workEnd, 0, 0, 0);

        while (true) {
            const slotStart = new Date(current);
            const slotEnd   = new Date(current.getTime() + duration * 60000);
            if (slotEnd > dayEnd) break;

            let therapistFree = true;
            let roomFree      = true;

            // ── Check Therapist ──────────────────────────────
            if (this.state.slotTherapistId) {
                const c = await this.orm.searchCount("spa.appointment", [
                    ["therapist_id", "=", parseInt(this.state.slotTherapistId)],
                    ["state", "in", ["confirmed", "in_progress"]],
                    ["start_datetime", "<", fmt(slotEnd)],
                    ["end_datetime",   ">", fmt(slotStart)],
                ]);
                therapistFree = c === 0;
            }

            // ── Check Room ───────────────────────────────────
            if (this.state.slotRoomId) {
                const c = await this.orm.searchCount("spa.appointment", [
                    ["room_id", "=", parseInt(this.state.slotRoomId)],
                    ["state", "in", ["confirmed", "in_progress"]],
                    ["start_datetime", "<", fmt(slotEnd)],
                    ["end_datetime",   ">", fmt(slotStart)],
                ]);
                roomFree = c === 0;
            }

            slots.push({
                label:        this._formatSlotTime(slotStart) + " – " + this._formatSlotTime(slotEnd),
                startRaw:     fmt(slotStart),
                endRaw:       fmt(slotEnd),
                therapistFree,
                roomFree,
                available:    therapistFree && roomFree,
            });

            current = slotEnd;
        }

        this.state.slots   = slots;
        this.state.loading = false;
    }

    // ── FILTER CHANGE ────────────────────────────────────────────

    async onFilterChange(field, ev) {
        this.state[field] = ev.target.value;
        await this.loadSlots();
    }

    // ── OPEN APPOINTMENT FORM ────────────────────────────────────

    openAppointment(slot) {
        this.action.doAction({
            type:      "ir.actions.act_window",
            name:      "New Appointment",
            res_model: "spa.appointment",
            view_mode: "form",
            views:     [[false, "form"]],
            target:    "current",
            context: {
                default_start_datetime: slot.startRaw,
                default_end_datetime:   slot.endRaw,
                default_therapist_id:   this.state.slotTherapistId
                                            ? parseInt(this.state.slotTherapistId)
                                            : undefined,
                default_room_id:        this.state.slotRoomId
                                            ? parseInt(this.state.slotRoomId)
                                            : undefined,
            },
        });
    }

    // ── BACK ─────────────────────────────────────────────────────

    goBack() {
        this.action.doAction("spa_wellness.action_spa_dashboard");
    }
}

registry.category("actions").add("spa_wellness.slot_checker", SpaSlotChecker);