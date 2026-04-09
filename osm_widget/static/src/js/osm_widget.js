/** @odoo-module **/

import { loadJS, loadCSS } from "@web/core/assets";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { Component, onMounted, onWillUnmount, useRef } from "@odoo/owl";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

class OsmMapWidget extends Component {
    static template = "osm_widget.OsmMap";
    static props = {
        ...standardFieldProps,
        latField: { type: String, optional: true },
        lngField: { type: String, optional: true },
    };

    setup() {
        this.mapRef   = useRef("map");
        this._map     = null;
        this._marker  = null;
        this.latField = this.props.latField || "latitude";
        this.lngField = this.props.lngField || "longitude";

        onMounted(async () => {
            await loadCSS(LEAFLET_CSS);
            await loadJS(LEAFLET_JS);
            this._initMap();
        });

        onWillUnmount(() => {
            this._map?.remove();
            this._map = null;
        });
    }

    get lat() { return this.props.record.data[this.latField] || 0; }
    get lng() { return this.props.record.data[this.lngField] || 0; }
    get hasLocation() { return !!(this.lat || this.lng); }

    _initMap() {
        if (!window.L || !this.mapRef.el) return;
        const L = window.L;

        const center = this.hasLocation ? [this.lat, this.lng] : [20, 0];
        const zoom   = this.hasLocation ? 14 : 2;

        this._map = L.map(this.mapRef.el, { center, zoom });

        // ── English tile layer (Cartocdn Voyager) ──────────────────────────────
        // Renders all country labels in English/Latin script globally.
        // Standard openstreetmap tiles render in local script (Arabic for Bahrain, etc.)
       // NEW — always English, globally, no API key needed
       L.tileLayer("https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png", {
            attribution: '© <a href="https://stamen.com">Stamen</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 20,
        }).addTo(this._map);
        if (this.hasLocation) this._addMarker(this.lat, this.lng);

        if (!this.props.readonly) {
            this._map.on("click", (e) => this._selectLocation(e.latlng.lat, e.latlng.lng));
        }

        setTimeout(() => this._map?.invalidateSize(), 150);
    }

    _addMarker(lat, lng) {
        const L = window.L;


        
        if (this._marker) {
            this._marker.setLatLng([lat, lng]);
            this._marker.setPopupContent(`<b>Company Location</b><br/>${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            return;
        }
        this._marker = L.marker([lat, lng], { draggable: !this.props.readonly })
            .addTo(this._map)
            .bindPopup(`<b>Company Location</b><br/>${lat.toFixed(6)}, ${lng.toFixed(6)}`);

        if (!this.props.readonly) {
            this._marker.on("dragend", (e) => {
                const p = e.target.getLatLng();
                this._selectLocation(p.lat, p.lng);
            });
        }
    }

    async _selectLocation(lat, lng) {
        const r = (v) => parseFloat(v.toFixed(7));

        // Store encoded value in the Char field — Python write() decodes this
        // and saves latitude + longitude directly to the database.
        // This is the ONLY field we need to update from JS.
        // The float fields update live via the Python onchange.
        await this.props.record.update({
            [this.props.name]: `${r(lat)},${r(lng)}`,
        });

        this._addMarker(lat, lng);
        this._map.panTo([lat, lng]);
    }

    async onClear() {
        await this.props.record.update({ [this.props.name]: false });
        if (this._marker) {
            this._map.removeLayer(this._marker);
            this._marker = null;
            this._map.setView([20, 0], 2);
        }
    }

    onSearchKeydown(ev) {
        if (ev.key === "Enter") this.onSearch(ev.target.value);
    }

    async onSearch(query) {
        if (!query.trim()) return;
        try {
            // ── accept-language=en forces English results from Nominatim ──────
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=en`;
            const data = await fetch(url, { headers: { "User-Agent": "Odoo-OSM-Widget/19.0" } }).then(r => r.json());
            if (data.length) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                this._map.setView([lat, lng], 14);
                await this._selectLocation(lat, lng);
            }
        } catch (e) {
            console.error("[OSM Widget] Search failed:", e);
        }
    }
}

registry.category("fields").add("osm_map", {
    component: OsmMapWidget,
    displayName: "OpenStreetMap Location",
    supportedTypes: ["char"],
    extractProps: ({ attrs }) => ({
        latField: attrs.lat_field || "latitude",
        lngField: attrs.lng_field || "longitude",
    }),
});