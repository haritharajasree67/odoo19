/** @odoo-module **/

import { registry }  from "@web/core/registry";
import { Component, useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";

class SpaAppointment extends Component {
    static template = "spa_wellness.SpaAppointment";

setup() {
        this.state = useState({
            records: [],
            date_from: "",
            date_to: "",
        });

        onWillStart(() => this.loadData());
    }

    async loadData() {
        const result = await rpc("/web/dataset/call_kw", {
            model: "spa.appointment",
            method: "get_appointment_report",
            args: [],
            kwargs: {
                date_from: this.state.date_from,
                date_to: this.state.date_to,
            },
        });

        this.state.records = result;
    }

    downloadXlsx() {

        let url = "/spa/appointment/report/xlsx?";
        if (this.state.date_from)
            url += "date_from=" + this.state.date_from + "&";

        if (this.state.date_to)
            url += "date_to=" + this.state.date_to;

        window.open(url, "_blank");
    }

}

registry.category("actions").add("spa_wellness.spa_appointment", SpaAppointment);