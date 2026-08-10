function dtime_nums(daysOffset, full) {
  var d = new Date();
  d.setDate(d.getDate() + daysOffset);
  var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  var day = d.getDate();
  var month = months[d.getMonth()];
  var year = d.getFullYear();
  document.write(day + ' ' + month + ' ' + year);
}
