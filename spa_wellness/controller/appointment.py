import io
import base64
import xlsxwriter
from odoo import http
from odoo.http import request


class SpaAppointmentReportController(http.Controller):

    @http.route('/spa/appointment/report/xlsx', type='http', auth='user')
    def download_appointment_xlsx(self, date_from=None, date_to=None, **kw):

        appointments = request.env['spa.appointment'].sudo().get_appointment_report(
            date_from, date_to
        )

        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output)
        sheet = workbook.add_worksheet("Appointments")

        headers = ['Appointment', 'Customer', 'Date', 'Total Price']

        for col, header in enumerate(headers):
            sheet.write(0, col, header)

        row = 1
        for rec in appointments:
            sheet.write(row, 0, rec['appointment'])
            sheet.write(row, 1, rec['customer'])
            sheet.write(row, 2, rec['date'])
            sheet.write(row, 3, rec['total_price'])
            row += 1

        workbook.close()
        output.seek(0)

        return request.make_response(
            output.read(),
            headers=[
                ('Content-Type',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                ('Content-Disposition',
                 'attachment; filename=appointment_report.xlsx')
            ]
        )