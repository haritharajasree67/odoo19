/** @odoo-module **/

import { registry }  from "@web/core/registry";
import { Component, useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";

class Commission extends Component {
    static template = "spa_wellness.Commission";


    setup() {

        this.state = useState({
            records: [],
            therapists: [],
            therapist_id: "",
            date_from: "",
            date_to: "",
        });

        onWillStart(async () => {
            await this.loadTherapists();
            await this.loadData();
        });
    }

    async loadTherapists() {
        this.state.therapists = await rpc("/web/dataset/call_kw", {
            model: "spa.therapist.commission",
            method: "get_therapists",
            args: [],
            kwargs: {},
        });
    }

    async loadData() {
        this.state.records = await rpc("/web/dataset/call_kw", {
            model: "spa.therapist.commission",
            method: "get_commission_data",
            args: [],
            kwargs: {
                date_from: this.state.date_from,
                date_to: this.state.date_to,
                therapist_id: this.state.therapist_id || false,
            },
        });
    }

    downloadXlsx() {
        const params = new URLSearchParams({
            therapist_id: this.state.therapist_id || "",
            date_from: this.state.date_from || "",
            date_to: this.state.date_to || "",
        });

        const url = `/spa/commission/xlsx?${params.toString()}`;
        window.open(url, "_blank");
    }

}

registry.category("actions").add("spa_wellness.commission", Commission);