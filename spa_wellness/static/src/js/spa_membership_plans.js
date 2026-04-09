/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class SpaMembershipPlans extends Component {
    static template = "spa_wellness.MembershipPlans";

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        this.state = useState({
            plans:   [],
            loading: true,
        });

        onWillStart(async () => {
            await this.loadPlans();
        });
    }

    // ── LOAD PLANS ───────────────────────────────────────────────

    async loadPlans() {
        this.state.loading = true;

        const plans = await this.orm.searchRead(
            "spa.membership.plan",
            [["active", "=", true]],
            ["id", "name", "duration", "duration_type", "price",
             "note", "consultation_count",
             "service_line_ids", "product_line_ids"],
            { order: "name asc" }
        );

        // Load service lines for each plan
        const allServiceLineIds = [...new Set(plans.flatMap(p => p.service_line_ids || []))];
        let serviceLineMap = {};
        if (allServiceLineIds.length > 0) {
            const serviceLines = await this.orm.searchRead(
                "spa.membership.plan.service",
                [["id", "in", allServiceLineIds]],
                ["id", "service_id", "allowed_sessions", "discount_percentage"]
            );
            serviceLines.forEach(sl => { serviceLineMap[sl.id] = sl; });
        }

        // Load product lines for each plan
        const allProductLineIds = [...new Set(plans.flatMap(p => p.product_line_ids || []))];
        let productLineMap = {};
        if (allProductLineIds.length > 0) {
            const productLines = await this.orm.searchRead(
                "spa.membership.plan.product",
                [["id", "in", allProductLineIds]],
                ["id", "product_id", "discount_percentage"]
            );
            productLines.forEach(pl => { productLineMap[pl.id] = pl; });
        }

        this.state.plans = plans.map(p => ({
            ...p,
            serviceLines:  (p.service_line_ids || []).map(id => serviceLineMap[id]).filter(Boolean),
            productLines:  (p.product_line_ids || []).map(id => productLineMap[id]).filter(Boolean),
            durationLabel: `${p.duration} ${p.duration_type}`,
            priceLabel:    p.price ? `${p.price.toFixed(2)}` : "Free",
        }));

        this.state.loading = false;
    }

    // ── OPEN MEMBERSHIP FORM ─────────────────────────────────────

openPlan(planId) {
    this.action.doAction({
        type:      "ir.actions.act_window",
        name:      "New Membership",
        res_model: "spa.membership",
        view_mode: "form",
        views:     [[false, "form"]],
        target:    "current",
        context: {
            default_membership_plan: planId,
        },
    });
}

    // ── BACK ─────────────────────────────────────────────────────

    goBack() {
        this.action.doAction("spa_wellness.action_spa_dashboard");
    }
}

registry.category("actions").add("spa_wellness.membership_plans", SpaMembershipPlans);