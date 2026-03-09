// ============================================
// GOOGLE APPS SCRIPT — Groundwork Feedback
// ============================================
//
// SETUP INSTRUCTIONS (takes ~3 minutes):
//
// 1. Go to https://sheets.new to create a new Google Sheet
// 2. Name it "Groundwork Feedback"
// 3. In Row 1, add these headers:
//    A1: Timestamp | B1: Name | C1: Email | D1: Feedback | E1: Interest | F1: Submitted
// 4. Go to Extensions → Apps Script
// 5. Delete any code in the editor and paste everything below
// 6. Click "Deploy" → "New deployment"
// 7. Choose type: "Web app"
//    - Description: "Groundwork Feedback"
//    - Execute as: "Me"
//    - Who has access: "Anyone"
// 8. Click "Deploy" and authorize when prompted
// 9. Copy the Web app URL
// 10. Paste it into index.html replacing PASTE_YOUR_APPS_SCRIPT_URL_HERE
//
// That's it! Feedback will appear in your Google Sheet.
// ============================================

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.timestamp,
    data.name,
    data.email,
    data.feedback,
    data.interest,
    new Date().toLocaleString()
  ]);

  // Optional: send yourself an email notification
  // Uncomment the lines below if you want email alerts
  // MailApp.sendEmail({
  //   to: 'elizabethmck@gmail.com',
  //   subject: 'Groundwork Feedback from ' + data.name,
  //   body: 'Name: ' + data.name + '\n' +
  //         'Email: ' + data.email + '\n' +
  //         'Interest: ' + data.interest + '\n\n' +
  //         'Feedback:\n' + data.feedback
  // });

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}
