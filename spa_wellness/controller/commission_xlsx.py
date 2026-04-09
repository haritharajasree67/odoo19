from odoo import http
from odoo.http import request
from io import BytesIO
from openpyxl import Workbook
from datetime import datetime


class SpaCommissionXlsx(http.Controller):

    @http.route(
        '/spa/commission/xlsx',
        type='http',
        auth='user',
        csrf=False
    )
    def download_commission_xlsx(self, date_from=None, date_to=None, therapist_id=None, **kw):

        Commission = request.env['spa.therapist.commission'].sudo()

        domain = []

        if therapist_id:
            domain.append(('therapist_id', '=', int(therapist_id)))

        if date_from:
            domain.append(
                ('appointment_id.start_datetime', '>=', date_from)
            )

        if date_to:
            domain.append(
                ('appointment_id.start_datetime', '<=', date_to)
            )

        records = Commission.search(domain)

        # =============================
        # Create XLSX
        # =============================
        wb = Workbook()
        ws = wb.active
        ws.title = "Therapist Commission"

        # Header
        headers = [
            "Appointment",
            "Therapist",
            "Service",
            "Service Amount",
            "Commission Type",
            "Commission Value",
            "Commission Amount",
        ]

        ws.append(headers)

        # Data rows
        for rec in records:
            ws.append([
                rec.appointment_id.name,
                rec.therapist_id.name,
                rec.service_id.name,
                rec.service_amount,
                rec.commission_type,
                rec.commission_value,
                rec.commission_amount,
            ])

        # Save file in memory
        output = BytesIO()
        wb.save(output)
        output.seek(0)

        filename = "Therapist_Commission.xlsx"

        return request.make_response(
            output.read(),
            headers=[
                ('Content-Type',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                ('Content-Disposition',
                 f'attachment; filename={filename}')
            ]
        )