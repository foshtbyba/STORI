function dtime_nums(offset, show) {
  var d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  var day = d.getDate();
  var month = d.getMonth();
  var year = d.getFullYear();
  var months = [
    'հունվարի',
    'փետրվարի',
    'մարտի',
    'ապրիլի',
    'մայիսի',
    'հունիսի',
    'հուլիսի',
    'օգոստոսի',
    'սեպտեմբերի',
    'հոկտեմբերի',
    'նոյեմբերի',
    'դեկտեմբերի'
  ];
  if (show) {
    document.write(day + ' ' + months[month] + ', ' + year + 'թ.');
  }
  return day + ' ' + months[month] + ', ' + year;
}
