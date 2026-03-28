<!DOCTYPE html>
<!--[if IE 8]> <html lang="en" class="ie8 no-js"> <![endif]-->
<!--[if IE 9]> <html lang="en" class="ie9 no-js"> <![endif]-->
<!--[if !IE]><!-->
<html lang="en">
<!--<![endif]-->
	<head>
		<?php include 'include/global.php'; ?>
		<?php include 'include/head.php'; ?>
	</head>
	<body>
		<nav class="navbar navbar-default navbar-fixed-top" role="navigation">
			<div class="container">
				<div class="navbar-header">
					<button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar" aria-expanded="false" aria-controls="navbar">
					<span class="sr-only">Toggle navigation</span>
					<span class="icon-bar"></span>
					<span class="icon-bar"></span>
					<span class="icon-bar"></span>
					</button>
					<a class="navbar-brand" href="#">FlexCode SDK</a>
				</div>
				<div id="navbar" class="collapse navbar-collapse">
					<ul class="nav navbar-nav">
						<li><a href="#" onclick="load('<?php echo $base_path?>device.php?action=index')">Device</a></li>
						<li><a href="#" onclick="load('<?php echo $base_path?>user.php?action=index')">User</a></li>
						<li><a href="#" onclick="load('<?php echo $base_path?>login.php?action=index')">Login</a></li>
						<li><a href="#" onclick="load('<?php echo $base_path?>log.php?action=index')">Log</a></li>
						<li><a href="<?php echo $base_path?>documentation/index.html" target="_blank">Documentation</a></li>
					</ul>
				</div><!--/.nav-collapse -->
			</div>
		</nav>
		<div class="container">
			<div class="row">
				<div class="col-md-12 text-center">
					<h2><code>How it works?</code></h2>
					<iframe width="560" height="315" src="https://www.youtube.com/embed/E6c3Zc5IMU4?showinfo=0&amp;wmode=opaque" frameborder="0" gesture="media" allowfullscreen></iframe>
				</div>
			</div>
			<div class="row">
				<div class="col-md-12">
					<div id="content">

					</div>
				</div>
			</div>
		</div>

	<script>
		jQuery(document).ready(function() {

			console.log('ready to use...');

			load('<?php echo $base_path?>device.php?action=index');

		});
	</script>
	</body>
</html>