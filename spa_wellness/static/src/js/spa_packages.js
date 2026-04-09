/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class SpaPackages extends Component {
    static template = "spa_wellness.SpaPackages";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            packages: [],
            loading: true,
        });

        onWillStart(async () => {
            await this.loadPackages();
        });
    }

    // ─────────────────────────────────
    // LOAD PACKAGES
    // ─────────────────────────────────
    async loadPackages() {
        this.state.loading = true;

        const packages = await this.orm.searchRead(
            "spa.package.template",
            [["active", "=", true]],
            ["id", "name", "price", "validity_days", "line_ids"],
            { order: "name asc" }
        );

        // Load service lines
        const allLineIds = [...new Set(packages.flatMap(p => p.line_ids || []))];

        let lineMap = {};
        if (allLineIds.length) {
            const lines = await this.orm.searchRead(
                "spa.package.template.line",
                [["id", "in", allLineIds]],
                ["id", "service_id", "sessions"]
            );

            lines.forEach(l => {
                lineMap[l.id] = l;
            });
        }

        this.state.packages = packages.map(p => ({
            ...p,
            lines: (p.line_ids || [])
                .map(id => lineMap[id])
                .filter(Boolean),
            validityLabel: `${p.validity_days} Days`,
            priceLabel: p.price ? `${p.price.toFixed(2)}` : "Free",
        }));

        this.state.loading = false;
    }

    openBookingPanel() {
        this.action.doAction("spa_wellness.action_spa_booking_panel");
    }

    // ─────────────────────────────────
    // OPEN PACKAGE FORM
    // ─────────────────────────────────
    openPackage(packageId) {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "New Package",
            res_model: "spa.appointment",
            view_mode: "form",
            views: [[false, "form"]],
            target: "current",
            context: {
                default_package_id: packageId,
            },
        });
    }

    // ─────────────────────────────────
    // BACK TO DASHBOARD
    // ─────────────────────────────────
    goBack() {
        this.action.doAction("spa_wellness.action_spa_dashboard");
    }
}

registry.category("actions").add(
    "spa_wellness.spa_packages",
    SpaPackages
);