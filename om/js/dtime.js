function dtime_nums(offset, asText) {
  var d = new Date();
  d.setDate(d.getDate() + offset);
  var day = d.getDate();
  var month = d.getMonth() + 1;
  var year = d.getFullYear();
  var months_ar = [
    '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  if (asText) {
    document.write(day + ' ' + months_ar[month] + ' ' + year);
  } else {
    document.write(day + '/' + month + '/' + year);
  }
}
