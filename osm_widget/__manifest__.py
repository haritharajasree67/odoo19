# -*- coding: utf-8 -*-
{
    'name': 'Company Location Map',
    'version': '19.0.1.0.0',
    'category': 'Tools',
    'summary': 'Add an OpenStreetMap location picker to Company settings',
    'depends': ['base', 'web','hr'],
    'data': [
        'views/res_company_views.xml',
    ],
    # partner_latitude / partner_longitude already exist on res.company
    # (inherited from res.partner) — no extra Python models needed.
    'assets': {
        'web.assets_backend': [
            'osm_widget/static/src/css/osm_widget.css',
            'osm_widget/static/src/xml/osm_widget.xml',
            'osm_widget/static/src/js/osm_widget.js',
        ],
    },
    'installable': True,
    'license': 'LGPL-3',
}
