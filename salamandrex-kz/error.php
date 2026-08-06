<?php
// $page_text передается через api.php -> includeWithVariables
?>
<!DOCTYPE html>
<html lang='ru'>
<head>
    <meta http-equiv='Content-Type' content='text/html;charset=UTF-8'>
    <!-- <meta charset='utf-8'> -->
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title><?php echo $page_text['error'];?></title>
    <link type='text/css' rel='stylesheet' href='css/style.css'>
</head>
<body>
<div class='wrap_block_success'>
    <div class='block_success'>
        <h1><?php echo $page_text['error'];?></h1><h2> <?php echo $page_text['order_error'];?> </h2>
		<?php
        // $output передается из api.php
            if(isset($output)){
               echo $output;
            } elseif(isset($errors)) {
                foreach($errors as $error){
                    if(isset($error['field'])){
                        echo $error['field'] . ': ';    
                    }
                    echo $error['text'] . '<br>';                   
                } 
            } else {
                echo "unknown error";
            }
		?>
		<h2><a href="#" onclick="history.back();return false;" class="history-back"><?php echo $page_text['return'];?></a></h2><p>
    </div>
</div>
</body>
</html>

